import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";

/**
 * Consolidate every `guardians` row that shares a mobile number into a
 * single canonical row, then re-point `student_guardian_links` so every
 * student in the household references the survivor. Solves the original
 * Issue 2 — ERP imports historically minted one `guardians.erp_name`
 * per student-guardian pair, leaving the catalog with several rows per
 * phone, which broke `lib/parent-lookup.ts:resolveFamilyParent` (which
 * limits to one) and made admin cleanup tedious.
 *
 *   POST  { phone: "9876543210", canonicalErpName?: "GUARDIAN-2024-00123" }
 *
 * Behaviour:
 *   1. Normalise the input to the last 10 digits via the same regex
 *      `lib/phone.ts:last10Sql` uses elsewhere.
 *   2. Find every `guardians` row whose mobile_number normalises to the
 *      same 10 digits.
 *   3. Pick the canonical row:
 *        - explicit `canonicalErpName` from the body wins if supplied;
 *        - otherwise the row most-referenced by student_guardian_links
 *          (so we minimise the number of link rows that need rewriting);
 *        - deterministic tie-break: oldest synced_at, then smallest id.
 *   4. UPDATE student_guardian_links.guardian_erp_name → canonical for
 *      every non-canonical guardian's erp_name.
 *   5. DELETE the non-canonical rows in the same transaction.
 *   6. Return counts so the UI can render "Merged 3 rows → 1; rewired
 *      27 student links".
 *
 * Idempotent: re-running for a phone that has only one guardian row is
 * a no-op (`mergedCount = 0, linksRewired = 0`).
 */

const Body = z.object({
  phone: z.string().regex(/^\d{10}$/),
  canonicalErpName: z.string().optional(),
});

type GuardianRow = {
  id: string;
  erp_name: string | null;
  guardian_name: string | null;
  mobile_number: string | null;
  synced_at: string | null;
  link_count: number;
};

export async function POST(req: Request) {
  // Restrict to super-admins. Merging touches identity tables that ops
  // staff shouldn't be able to mass-mutate without escalation.
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const parsed = await parseJson(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const { phone, canonicalErpName } = parsed;

  // Step 1+2 — pull all guardians for this phone, with their link counts.
  const matchedRes = await db.execute(sql`
    SELECT g.id,
           g.erp_name,
           g.guardian_name,
           g.mobile_number,
           g.synced_at,
           (SELECT COUNT(*) FROM student_guardian_links sgl
             WHERE sgl.guardian_erp_name = g.erp_name) AS link_count
      FROM guardians g
     WHERE right(regexp_replace(coalesce(g.mobile_number, ''), '\D', '', 'g'), 10) = ${phone}
     ORDER BY link_count DESC, g.synced_at ASC NULLS LAST, g.id ASC
  `);
  const rows = ((matchedRes as { rows?: GuardianRow[] }).rows ??
    (matchedRes as unknown as GuardianRow[])) as GuardianRow[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "No guardians found for that phone" }, { status: 404 });
  }
  if (rows.length === 1) {
    return NextResponse.json({
      ok: true,
      noop: true,
      kept: rows[0].erp_name,
      mergedCount: 0,
      linksRewired: 0,
    });
  }

  // Step 3 — pick canonical.
  let canonical = rows[0];
  if (canonicalErpName) {
    const explicit = rows.find((r) => r.erp_name === canonicalErpName);
    if (!explicit) {
      return NextResponse.json(
        { error: `canonicalErpName "${canonicalErpName}" is not among the matched guardians` },
        { status: 400 }
      );
    }
    canonical = explicit;
  }
  if (!canonical.erp_name) {
    // The canonical row must have an erp_name for student_guardian_links
    // to reference. If somehow the highest-link row is missing one, mint
    // LOCAL-PH-{phone} on it before the rewire.
    const minted = `LOCAL-PH-${phone}`;
    await db.execute(sql`
      UPDATE guardians SET erp_name = ${minted} WHERE id = ${canonical.id}
    `);
    canonical = { ...canonical, erp_name: minted };
  }

  const losers = rows.filter((r) => r.id !== canonical.id);
  const loserErpNames = losers.map((r) => r.erp_name).filter((s): s is string => !!s);

  // Steps 4+5 — rewire links, then delete losers. Transaction so both
  // halves land atomically; an interrupted run won't leave dangling
  // guardian_erp_name references.
  let linksRewired = 0;
  await db.transaction(async (tx) => {
    if (loserErpNames.length > 0) {
      // postgres-js doesn't bind JS arrays to PG `text[]` cleanly; emit
      // an IN-list of bound text params instead so each value is escaped
      // individually.
      const inList = sql.join(loserErpNames.map((n) => sql`${n}`), sql`, `);
      const rewire = await tx.execute(sql`
        UPDATE student_guardian_links
           SET guardian_erp_name = ${canonical.erp_name}
         WHERE guardian_erp_name IN (${inList})
        RETURNING id
      `);
      linksRewired = ((rewire as { rowCount?: number; rows?: unknown[] }).rowCount ??
        ((rewire as { rows?: unknown[] }).rows ?? []).length) as number;
    }

    // Merge metadata onto the canonical row before deletion so we don't
    // lose useful info (e.g. an alternate_number that only the losing
    // row had). Patch is "fill blanks only" — we never overwrite a non-
    // null canonical value.
    const merged: Record<string, unknown> = {};
    for (const k of [
      "guardian_name",
      "mobile_number",
      "email_address",
      "email",
    ] as const) {
      if (!canonical[k as keyof GuardianRow]) {
        const donor = losers.find((r) => r[k as keyof GuardianRow]);
        if (donor) merged[k] = donor[k as keyof GuardianRow];
      }
    }
    if (Object.keys(merged).length > 0) {
      const set = Object.entries(merged)
        .map(([k, v]) => sql`${sql.raw(k)} = ${v}`)
        // Drizzle needs a single SQL fragment for SET; we join with commas.
        .reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));
      await tx.execute(sql`UPDATE guardians SET ${set} WHERE id = ${canonical.id}`);
    }

    const loserIds = losers.map((r) => r.id);
    if (loserIds.length > 0) {
      const idList = sql.join(loserIds.map((n) => sql`${n}`), sql`, `);
      await tx.execute(sql`DELETE FROM guardians WHERE id IN (${idList})`);
    }
  });

  revalidatePath("/admin/guardians");
  revalidatePath("/admin/students");

  return NextResponse.json({
    ok: true,
    phone,
    kept: canonical.erp_name,
    mergedCount: losers.length,
    linksRewired,
  });
}
