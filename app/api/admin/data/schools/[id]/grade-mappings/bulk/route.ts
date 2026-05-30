import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";

/**
 * Bulk grade-mapping insert. The single-row sibling endpoint stays untouched
 * for code paths that add one mapping at a time (e.g. the school detail
 * page's inline editor). This route exists so the new-school wizard can
 * commit 12 grades in one round-trip instead of 12 sequential POSTs.
 *
 * Idempotency: rows for grades that already exist on this school are
 * silently skipped (no error). This means the wizard can be re-submitted
 * safely on flaky network without producing duplicates.
 */
const Body = z.object({
  rows: z
    .array(
      z.object({
        grade: z.string().min(1),
        schoolGivenGradeName: z.string().nullable().optional(),
        sections: z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(50),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id: schoolId } = await params;
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  // Single transaction wraps the read-then-insert so two parallel wizard
  // submissions can't both compute the same MAX(row_idx)+1 and collide.
  // The schoolGradeMappings table has a UNIQUE(school_id, lower(grade))
  // index (migration 0023) which is the final backstop — we translate that
  // unique-violation into a 409 so the wizard surfaces a clean error.
  try {
    const result = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ grade: schema.schoolGradeMappings.grade })
        .from(schema.schoolGradeMappings)
        .where(eq(schema.schoolGradeMappings.schoolId, schoolId));
      const existingSet = new Set(existing.map((r) => (r.grade ?? "").toLowerCase()));

      const fresh = body.rows.filter((r) => !existingSet.has(r.grade.toLowerCase()));
      if (fresh.length === 0) {
        return { inserted: 0, skipped: body.rows.length };
      }

      const [{ next: startIdx }] = await tx
        .select({ next: sql<number>`COALESCE(MAX(row_idx), 0) + 1` })
        .from(schema.schoolGradeMappings)
        .where(eq(schema.schoolGradeMappings.schoolId, schoolId));
      const start = Number(startIdx ?? 1);

      const values = fresh.map((r, i) => ({
        schoolId,
        rowIdx: start + i,
        grade: r.grade,
        schoolGivenGradeName: r.schoolGivenGradeName ?? null,
        sections: r.sections ?? null,
      }));

      await tx.insert(schema.schoolGradeMappings).values(values);

      return { inserted: fresh.length, skipped: body.rows.length - fresh.length };
    });

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique constraint/i.test(msg)) {
      return NextResponse.json(
        { error: "Another request just added the same grades — please refresh and try again." },
        { status: 409 }
      );
    }
    throw err;
  }
}
