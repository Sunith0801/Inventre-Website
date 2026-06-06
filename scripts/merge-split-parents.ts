/* eslint-disable no-console */
/**
 * Merge split parents rows into one canonical row per phone-closure family.
 *
 * Why: when the same family signs in via different guardian phones at
 * different times, each phone creates its own `parents` row. The transitive
 * phone-graph fix in lib/session.ts hides this from parent login (siblings
 * still show up correctly), but every downstream feature that uses
 * `parents.id` as the family key — cart, sibling group at checkout, order
 * history, addresses, loyalty — still sees them as separate families. The
 * Audit at 2026-06-06 found ~904 parents rows tangled in split families.
 *
 * What this script does:
 *   1. Build phone-closure connected components from student_guardian_links.
 *   2. For each component, find every `parents` row that owns any of the
 *      component's students via students.parent_id.
 *   3. If a component touches >1 parents row, it's a split family.
 *   4. Pick a canonical row (most recently active → most students →
 *      oldest created_at).
 *   5. Re-point every child table (students, addresses, carts, orders,
 *      invoices, returns, reviews, loyalty_ledger, payment_entries,
 *      discount_usages, gift_cards, communications, wishlists,
 *      product_drafts, website_cart_coupon_usages) at the canonical id.
 *   6. Merge carts: if both canonical AND a redundant parent had a cart,
 *      move cart_items into the canonical cart, then delete the empty one.
 *      Relies on the (cart_id, variant_id) unique index from migration 0050:
 *      ON CONFLICT DO UPDATE keeps the higher qty so neither side loses.
 *   7. DELETE the redundant parents rows (cascade tables clean up).
 *
 * Usage:
 *   npx tsx scripts/merge-split-parents.ts              # dry-run
 *   npx tsx scripts/merge-split-parents.ts --apply      # commit
 *   npx tsx scripts/merge-split-parents.ts --limit 5    # process N families
 *
 * Safe to re-run: each family is processed in its own transaction; only
 * commits when --apply is set. Idempotent — once a family is collapsed,
 * the second run finds nothing to do for it.
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env.deploy") });

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const LIMIT_IDX = process.argv.indexOf("--limit");
const LIMIT = LIMIT_IDX > 0 ? parseInt(process.argv[LIMIT_IDX + 1] ?? "0", 10) || null : null;

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_DIRECT_URL or DATABASE_URL required");
  process.exit(1);
}
const sql = postgres(url, { max: 1 });

type PhoneRow = { student_id: string; phone10: string };
type StudentRow = { id: string; parent_id: string | null; enrollment_number: string | null; name: string | null };
type ParentRow = {
  id: string;
  phone: string;
  name: string | null;
  created_at: string;
  last_login_at: string | null;
  total_order_count: number;
};

// Union-find over phones AND students to build connected components.
class UF {
  parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x);
    if (!p || p === x) {
      this.parent.set(x, x);
      return x;
    }
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

async function main() {
  console.log(APPLY ? "▶ APPLY mode (will commit)" : "▶ DRY-RUN mode (no writes)");

  // 1) Pull every (student_id, last10(phone)) link.
  const rows: PhoneRow[] = (await sql`
    SELECT gl.student_id::text AS student_id,
           right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10) AS phone10
      FROM student_guardian_links gl
     WHERE gl.phone_no IS NOT NULL
       AND length(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g')) >= 10
  `) as unknown as PhoneRow[];
  console.log(`Loaded ${rows.length} guardian-link rows`);

  // 2) Build closure: union the student-id with each of its phones.
  const uf = new UF();
  for (const r of rows) {
    uf.union("s:" + r.student_id, "p:" + r.phone10);
  }

  // 3) Bucket students into components.
  const studentToComp = new Map<string, string>();
  for (const r of rows) studentToComp.set(r.student_id, uf.find("s:" + r.student_id));

  // 4) Pull every student in any component so we can resolve their parent_id.
  const studentIds = Array.from(studentToComp.keys());
  const studentRows: StudentRow[] = studentIds.length
    ? ((await sql`
        SELECT id::text AS id, parent_id::text AS parent_id,
               enrollment_number, name
          FROM students
         WHERE id::text = ANY(${studentIds})
      `) as unknown as StudentRow[])
    : [];

  // 5) Group parents by component.
  const compToParentIds = new Map<string, Set<string>>();
  for (const s of studentRows) {
    if (!s.parent_id) continue;
    const comp = studentToComp.get(s.id)!;
    const set = compToParentIds.get(comp) ?? new Set<string>();
    set.add(s.parent_id);
    compToParentIds.set(comp, set);
  }

  // 6) Pick split families: components with >1 parents row.
  const splitFamilies: Array<{ comp: string; parentIds: string[] }> = [];
  for (const [comp, pset] of compToParentIds) {
    if (pset.size > 1) splitFamilies.push({ comp, parentIds: Array.from(pset) });
  }
  console.log(`Found ${splitFamilies.length} split families (each spans 2+ parents rows)`);
  if (splitFamilies.length === 0) {
    await sql.end({ timeout: 5 });
    return;
  }

  // 7) Hydrate parent rows we'll need.
  const allParentIds = Array.from(new Set(splitFamilies.flatMap((f) => f.parentIds)));
  const parentRows: ParentRow[] = (await sql`
    SELECT id::text AS id, phone, name,
           created_at::text AS created_at,
           last_login_at::text AS last_login_at,
           total_order_count
      FROM parents
     WHERE id::text = ANY(${allParentIds})
  `) as unknown as ParentRow[];
  const parentById = new Map(parentRows.map((p) => [p.id, p]));

  // 8) For each split family: choose canonical, plan + (apply).
  const planSummary = { families: 0, parentsDropped: 0, studentsRepointed: 0, cartsMerged: 0 };
  const families = LIMIT ? splitFamilies.slice(0, LIMIT) : splitFamilies;

  for (const fam of families) {
    const ps = fam.parentIds.map((id) => parentById.get(id)!).filter(Boolean);
    if (ps.length < 2) continue;

    // Canonical pick: highest last_login_at, then most orders, then oldest created_at.
    ps.sort((a, b) => {
      const ll = (b.last_login_at ?? "").localeCompare(a.last_login_at ?? "");
      if (ll !== 0) return ll;
      const oc = (b.total_order_count ?? 0) - (a.total_order_count ?? 0);
      if (oc !== 0) return oc;
      return a.created_at.localeCompare(b.created_at);
    });
    const canonical = ps[0];
    const redundant = ps.slice(1);

    // Stats per family.
    const studentsForFamily = studentRows.filter(
      (s) => s.parent_id && fam.parentIds.includes(s.parent_id),
    );

    console.log("");
    console.log(`Family ${planSummary.families + 1}: keep ${canonical.id} (${canonical.phone} · ${canonical.name ?? "—"})`);
    console.log(`  + students in family: ${studentsForFamily.length}`);
    for (const r of redundant) {
      console.log(`  ↳ merge ${r.id} (${r.phone} · ${r.name ?? "—"})`);
    }

    if (APPLY) {
      try {
        await sql.begin(async (tx) => {
          // 8a) Merge carts. If both canonical and a redundant parent have a
          //     cart, move items into the canonical cart with ON CONFLICT to
          //     dedupe by (cart_id, variant_id), keeping the higher qty.
          for (const r of redundant) {
            const [canonCart] = (await tx`
              SELECT id::text AS id FROM carts WHERE parent_id = ${canonical.id}::uuid LIMIT 1
            `) as unknown as { id: string }[];
            const [redCart] = (await tx`
              SELECT id::text AS id FROM carts WHERE parent_id = ${r.id}::uuid LIMIT 1
            `) as unknown as { id: string }[];
            if (redCart && canonCart) {
              await tx`
                INSERT INTO cart_items (cart_id, variant_id, qty, bundle_selections, student_id, added_at)
                SELECT ${canonCart.id}::uuid, variant_id, qty, bundle_selections, student_id, added_at
                  FROM cart_items WHERE cart_id = ${redCart.id}::uuid
                ON CONFLICT (cart_id, variant_id)
                  DO UPDATE SET qty = GREATEST(cart_items.qty, EXCLUDED.qty),
                                student_id = COALESCE(cart_items.student_id, EXCLUDED.student_id)
              `;
              await tx`DELETE FROM cart_items WHERE cart_id = ${redCart.id}::uuid`;
              await tx`DELETE FROM carts WHERE id = ${redCart.id}::uuid`;
              planSummary.cartsMerged++;
            } else if (redCart && !canonCart) {
              // Just re-point the cart.
              await tx`UPDATE carts SET parent_id = ${canonical.id}::uuid WHERE id = ${redCart.id}::uuid`;
            }
          }

          // 8b) Re-point every child table. Order matters only when there's
          //     a unique constraint that might clash; none of these have a
          //     unique constraint on parent_id alone.
          const redundantIds = redundant.map((r) => r.id);
          for (const tbl of [
            "students",
            "addresses",
            "orders",
            "invoices",
            "returns",
            "reviews",
            "loyalty_ledger",
            "payment_entries",
            "discount_usages",
            "communications",
            "wishlists",
            "product_drafts",
            "website_cart_coupon_usages",
          ]) {
            await tx.unsafe(
              `UPDATE ${tbl} SET parent_id = $1 WHERE parent_id = ANY($2)`,
              [canonical.id, redundantIds],
            );
          }
          // 8c) gift_cards uses a different column name.
          await tx`UPDATE gift_cards SET issued_to_parent_id = ${canonical.id}::uuid WHERE issued_to_parent_id = ANY(${redundantIds})`;

          // 8d) Recompute aggregates on the canonical from re-pointed orders.
          await tx`
            UPDATE parents p SET
              total_order_count = (SELECT COUNT(*) FROM orders WHERE parent_id = p.id),
              total_lifetime_value = COALESCE((SELECT SUM(total) FROM orders WHERE parent_id = p.id), 0),
              last_order_at = (SELECT MAX(created_at) FROM orders WHERE parent_id = p.id)
             WHERE p.id = ${canonical.id}::uuid
          `;

          // 8e) Drop redundant parents rows. Now safe — no FK references left.
          await tx`DELETE FROM parents WHERE id = ANY(${redundantIds})`;
        });
        planSummary.parentsDropped += redundant.length;
        planSummary.studentsRepointed += studentsForFamily.filter((s) => s.parent_id !== canonical.id).length;
      } catch (e) {
        console.error(`  ✗ FAILED family ${canonical.id}:`, e);
      }
    }

    planSummary.families++;
  }

  console.log("");
  console.log("─── Summary ───");
  console.log(`families processed:   ${planSummary.families}`);
  console.log(`parents rows dropped: ${planSummary.parentsDropped}`);
  console.log(`students re-pointed:  ${planSummary.studentsRepointed}`);
  console.log(`carts merged:         ${planSummary.cartsMerged}`);
  if (!APPLY) console.log("(dry-run — no writes happened. Re-run with --apply to commit.)");

  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
