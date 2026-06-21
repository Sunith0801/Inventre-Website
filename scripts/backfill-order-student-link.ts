/* eslint-disable no-console */
/**
 * One-time backfill: attach `orders.student_id` on unlinked orders by resolving
 * the student through a LAYERED rule (first layer that yields a UNIQUE student
 * wins). Linking durably fixes both the parent-visibility/exchange path AND the
 * grade sent to audit (a linked order sends `students.grade` — the catalog
 * grade — instead of falling back to the unreliable `grade_snapshot`).
 *
 * LAYERS (priority order, each scoped to the order's school + enabled/active
 * students):
 *   B  parent_id + school_id has exactly ONE active student  -> that student.
 *   C  parent has multiple actives, but exactly one whose `grade` OR `class`
 *      equals the order's `grade_snapshot`                    -> that student.
 *   D  guardian phone-graph: the order's parent phone (last-10) matches the
 *      `student_guardian_links.phone_no` of exactly one active student at the
 *      order's school                                         -> that student.
 *
 * Orders that resolve to no unique student under any layer are left unlinked
 * (RESIDUAL) — they then send a NULL grade to audit (visibly missing) rather
 * than a possibly-wrong snapshot. (Magic-Box orders still recover a grade via
 * deriveMagicBoxGrade in buildErpOrderPayload — that's grade recovery, not
 * student linking, so it's out of scope here.)
 *
 * Validated layer counts on the 2026-06-21 prod clone: B=8,738 C=1,606 D=1,137
 * (residual ~4,496 of 16,443 unlinked).
 *
 * USAGE (dry-run by default — writes NOTHING):
 *   npx tsx scripts/backfill-order-student-link.ts            # dry-run + per-layer report
 *   npx tsx scripts/backfill-order-student-link.ts --commit   # apply
 *
 * FLAGS
 *   --commit            Perform the UPDATE. Without it, nothing is written.
 *   --delivered-only    Restrict to orders.status = 'delivered'.
 *   --layers=B,C,D      Which layers to apply (default all). e.g. --layers=B
 *   --school=CODE       Restrict to one school_code.
 *
 * SAFETY / IDEMPOTENCY
 *   - WHERE guards on `student_id IS NULL`, so re-running never re-touches a
 *     linked row and never overwrites an existing link.
 *   - Each layer's uniqueness is enforced in SQL (correlated count = 1), so an
 *     ambiguous parent is never linked to an arbitrary student.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "../db/client";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const DELIVERED_ONLY = args.includes("--delivered-only");
const SCHOOL = (args.find((a) => a.startsWith("--school=")) ?? "").split("=")[1] || null;
const LAYERS = new Set(
  ((args.find((a) => a.startsWith("--layers=")) ?? "--layers=B,C,D").split("=")[1] || "B,C,D")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => ["B", "C", "D"].includes(s)),
);

const last10 = (col: ReturnType<typeof sql>) =>
  sql`right(regexp_replace(coalesce(${col},''), '\D', '', 'g'), 10)`;

// Per-order resolved student + layer. Each layer's subquery returns a student id
// only when it resolves UNIQUELY (correlated count = 1); COALESCE picks the
// highest-priority non-null. Layers not selected are forced to NULL.
const resolveCte = sql`
  filt AS (
    SELECT o.id AS order_id, o.parent_id, o.school_id, o.grade_snapshot
      FROM orders o
     WHERE o.student_id IS NULL
       AND o.parent_id IS NOT NULL
       ${DELIVERED_ONLY ? sql`AND o.status = 'delivered'` : sql``}
       ${SCHOOL ? sql`AND o.school_id IN (SELECT id FROM schools WHERE school_code = ${SCHOOL})` : sql``}
  ),
  cand AS (
    SELECT f.order_id,
      ${LAYERS.has("B")
        ? sql`(SELECT s.id FROM students s
                WHERE s.parent_id=f.parent_id AND s.school_id=f.school_id AND s.enabled AND s.status='active'
                  AND (SELECT count(*) FROM students s2 WHERE s2.parent_id=f.parent_id AND s2.school_id=f.school_id AND s2.enabled AND s2.status='active')=1
                LIMIT 1)`
        : sql`NULL::uuid`} AS b_sid,
      ${LAYERS.has("C")
        ? sql`(SELECT s.id FROM students s
                WHERE s.parent_id=f.parent_id AND s.school_id=f.school_id AND s.enabled AND s.status='active'
                  AND (s.grade=f.grade_snapshot OR s.class=f.grade_snapshot)
                  AND (SELECT count(*) FROM students s2 WHERE s2.parent_id=f.parent_id AND s2.school_id=f.school_id AND s2.enabled AND s2.status='active' AND (s2.grade=f.grade_snapshot OR s2.class=f.grade_snapshot))=1
                LIMIT 1)`
        : sql`NULL::uuid`} AS c_sid,
      ${LAYERS.has("D")
        ? sql`(SELECT s.id FROM student_guardian_links gl JOIN students s ON s.id=gl.student_id
                WHERE s.school_id=f.school_id AND s.enabled AND s.status='active'
                  AND ${last10(sql`gl.phone_no`)} = (SELECT ${last10(sql`p.phone`)} FROM parents p WHERE p.id=f.parent_id)
                  AND (SELECT count(DISTINCT s2.id) FROM student_guardian_links gl2 JOIN students s2 ON s2.id=gl2.student_id
                        WHERE s2.school_id=f.school_id AND s2.enabled AND s2.status='active'
                          AND ${last10(sql`gl2.phone_no`)} = (SELECT ${last10(sql`p2.phone`)} FROM parents p2 WHERE p2.id=f.parent_id))=1
                LIMIT 1)`
        : sql`NULL::uuid`} AS d_sid
      FROM filt f
  ),
  resolved AS (
    SELECT order_id,
           COALESCE(b_sid, c_sid, d_sid) AS student_id,
           CASE WHEN b_sid IS NOT NULL THEN 'B'
                WHEN c_sid IS NOT NULL THEN 'C'
                WHEN d_sid IS NOT NULL THEN 'D' END AS layer
      FROM cand
  )
`;

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = await db.execute(q);
  return (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as T[];
}

async function main() {
  console.log(
    `[relink] mode=${COMMIT ? "COMMIT" : "DRY-RUN"} layers=${[...LAYERS].join(",")} ` +
      `deliveredOnly=${DELIVERED_ONLY} school=${SCHOOL ?? "*"}`,
  );

  const [tot] = await rows<{ unlinked: number }>(
    sql`SELECT count(*)::int AS unlinked FROM orders WHERE student_id IS NULL`,
  );
  console.log(`[relink] unlinked orders total: ${tot.unlinked}`);

  const byLayer = await rows<{ layer: string | null; n: number }>(
    sql`WITH ${resolveCte} SELECT layer, count(*)::int AS n FROM resolved WHERE student_id IS NOT NULL GROUP BY layer ORDER BY layer`,
  );
  const linkable = byLayer.reduce((s, r) => s + r.n, 0);
  console.log(`[relink] resolvable in scope: ${linkable}`);
  for (const r of byLayer) console.log(`    layer ${r.layer}: ${r.n}`);

  if (!COMMIT) {
    console.log(`[dry-run] nothing written. Re-run with --commit to link ${linkable} orders.`);
    return;
  }

  const updated = await rows<{ layer: string }>(
    sql`WITH ${resolveCte}
        , upd AS (
          UPDATE orders o SET student_id = r.student_id
            FROM resolved r
           WHERE o.id = r.order_id AND r.student_id IS NOT NULL AND o.student_id IS NULL
          RETURNING r.layer
        )
        SELECT layer FROM upd`,
  );
  const counts = updated.reduce<Record<string, number>>((m, r) => {
    m[r.layer] = (m[r.layer] ?? 0) + 1;
    return m;
  }, {});
  console.log(`[done] linked ${updated.length} orders:`, counts);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[relink] FAILED:", e);
    process.exit(1);
  });
