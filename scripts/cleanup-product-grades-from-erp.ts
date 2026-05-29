/* eslint-disable no-console */
/**
 * Re-derive product_grades from the live ERP item feed.
 *
 * Past runs of scripts/backfill-grades-from-bom.ts copied parent Magic Box /
 * Bookkit grades onto every reachable leaf. ERP itself only carries the
 * uniform grade on the leaf (e.g. "SMS 9-10 Boys Pants" → custom_grade =
 * "Grade 12, Grade 13"). The shop filter sees the contamination.
 *
 * For each ERP item:
 *   1. Read effective.custom_grade (CSV) — the Uniform Grade field.
 *   2. Translate any school-given names (e.g. "Class 5", "Nursery") to the
 *      product's school uniform grades via school_grade_mappings.
 *   3. Compute the target set and reconcile product_grades.
 *
 * Items without an ERP custom_grade are skipped — no authoritative signal.
 *
 * Usage:
 *   tsx scripts/cleanup-product-grades-from-erp.ts            # dry run
 *   tsx scripts/cleanup-product-grades-from-erp.ts --apply    # write
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

const ERP_FEED_BASE = process.env.ERP_FEED_BASE;
const ERP_FEED_KEY = process.env.ERP_FEED_KEY;
if (!ERP_FEED_BASE || !ERP_FEED_KEY) {
  console.error("ERP_FEED_BASE / ERP_FEED_KEY not set");
  process.exit(1);
}

type FeedItem = {
  erp_name: string;
  item_name: string;
  custom_grade: string | null;
  effective?: { custom_grade?: string | null } | null;
};

async function fetchAllItems(): Promise<FeedItem[]> {
  const out: FeedItem[] = [];
  let start = 0;
  const limit = 1000;
  for (;;) {
    const url = `${ERP_FEED_BASE}/api/items/export?start=${start}&limit=${limit}`;
    const res = await fetch(url, { headers: { "X-Feed-Key": ERP_FEED_KEY! } });
    if (!res.ok)
      throw new Error(`feed ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 300));
    const page = (await res.json()) as { items: FeedItem[]; count: number };
    out.push(...page.items);
    if (page.count < limit) return out;
    start += limit;
  }
}

function splitGrades(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(",").map((g) => g.trim()).filter((g) => g.length > 0);
}

// Inlined helpers (mirror lib/grade-filter.ts + lib/grade-translate.ts to
// avoid Next.js's "server-only" marker when running via plain tsx).
function normalizeGrade(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  const stripped = t.replace(/^(grade|class|std\.?|standard)\s+/i, "").trim();
  const roman: Record<string, string> = {
    i: "1", ii: "2", iii: "3", iv: "4", v: "5",
    vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
    xi: "11", xii: "12",
  };
  if (roman[stripped]) return roman[stripped];
  const n = parseInt(stripped, 10);
  if (!Number.isNaN(n) && String(n) === stripped) return String(n);
  return stripped;
}

const ERP_TO_REAL: Record<string, string> = {
  "Grade 1": "Nursery", "Grade 2": "LKG", "Grade 3": "UKG",
  "Grade 4": "Grade 1", "Grade 5": "Grade 2", "Grade 6": "Grade 3",
  "Grade 7": "Grade 4", "Grade 8": "Grade 5", "Grade 9": "Grade 6",
  "Grade 10": "Grade 7", "Grade 11": "Grade 8", "Grade 12": "Grade 9",
  "Grade 13": "Grade 10", "Grade 14": "Grade 11", "Grade 15": "Grade 12",
  Nursery: "Nursery", LKG: "LKG", UKG: "UKG",
};

function looksLikeErpUniform(raw: string): boolean {
  const s = raw.trim();
  if (/^grade\s+\d{1,2}(\s+\w+)?$/i.test(s)) return true;
  if (/^(nursery|lkg|ukg)$/i.test(s)) return true;
  return false;
}

function erpGradeToReal(raw: string): string | null {
  const trimmed = raw.trim();
  if (ERP_TO_REAL[trimmed]) return ERP_TO_REAL[trimmed];
  const m = trimmed.match(/^grade[\s\-_]*(\d{1,2})$/i);
  if (m) return ERP_TO_REAL[`Grade ${parseInt(m[1], 10)}`] ?? null;
  return null;
}

async function main() {
  console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log("fetching ERP feed...");
  const items = await fetchAllItems();
  console.log(`  ${items.length} ERP items`);

  // Pre-load per-school maps. bySchoolGiven indexes the normalised
  // school-local label → ERP uniform grade. The Targeted-Grade output is
  // computed downstream via erpGradeToReal on the resolved uniform value.
  type SchoolMap = { bySchoolGiven: Map<string, string> };
  const mappings = new Map<string, SchoolMap>();
  const mRows = (await db.execute(sql`
    SELECT school_id, grade, school_given_grade_name
      FROM school_grade_mappings
     WHERE grade IS NOT NULL AND school_given_grade_name IS NOT NULL
  `)) as unknown as { school_id: string; grade: string; school_given_grade_name: string }[];
  for (const r of mRows) {
    const entry = mappings.get(r.school_id) ?? { bySchoolGiven: new Map<string, string>() };
    const nGiven = normalizeGrade(r.school_given_grade_name);
    if (nGiven && !entry.bySchoolGiven.has(nGiven)) {
      entry.bySchoolGiven.set(nGiven, r.grade);
    }
    mappings.set(r.school_id, entry);
  }

  let processed = 0;
  let skippedNoGrade = 0;
  let skippedNoProduct = 0;
  let touched = 0;
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const it of items) {
    processed++;
    const csv = it.effective?.custom_grade ?? it.custom_grade ?? null;
    const erpGrades = splitGrades(csv);
    if (erpGrades.length === 0) {
      skippedNoGrade++;
      continue;
    }

    // Match by erp_name first, then item_code. Older imports stored ERP's
    // auto-generated UUID-shaped `name` in products.erp_name; newer ones
    // store the friendly id. The friendly id always lives in item_code.
    const prodRows = (await db.execute(sql`
      SELECT id FROM products
       WHERE erp_name = ${it.erp_name}
          OR item_code = ${it.erp_name}
       LIMIT 1
    `)) as unknown as { id: string }[];
    if (!prodRows[0]) {
      skippedNoProduct++;
      continue;
    }
    const productId = prodRows[0].id;

    const psRows = (await db.execute(sql`
      SELECT school_id FROM product_school WHERE product_id = ${productId}
    `)) as unknown as { school_id: string }[];
    const schoolIds = psRows.map((r) => r.school_id);

    // Resolve each ERP custom_grade value to the Targeted-Grade vocabulary:
    //   - "Grade N" / Nursery / LKG / UKG  → erpGradeToReal directly
    //   - otherwise → look up school_grade_mappings.school_given_grade_name,
    //     then erpGradeToReal the resulting uniform value.
    // If we can't resolve, fall back to the raw ERP value so the tag isn't
    // silently dropped.
    const target = new Set<string>();
    for (const g of erpGrades) {
      if (looksLikeErpUniform(g)) {
        const real = erpGradeToReal(g);
        target.add(real ?? g);
        continue;
      }
      const n = normalizeGrade(g);
      let resolved: string | null = null;
      if (n) {
        for (const sid of schoolIds) {
          const map = mappings.get(sid);
          if (!map) continue;
          const uniform = map.bySchoolGiven.get(n);
          if (uniform) {
            resolved = erpGradeToReal(uniform) ?? uniform;
            break;
          }
        }
      }
      target.add(resolved ?? g);
    }

    const existingRows = (await db.execute(sql`
      SELECT grade FROM product_grades WHERE product_id = ${productId}
    `)) as unknown as { grade: string }[];
    const existing = new Set(existingRows.map((r) => r.grade));

    const missing = [...target].filter((g) => !existing.has(g));
    const extra = [...existing].filter((g) => !target.has(g));
    if (missing.length === 0 && extra.length === 0) continue;
    touched++;

    console.log(
      `  ${APPLY ? "[update]" : "[dry-run]"} ${it.item_name} (id=${productId}) erp=[${erpGrades.join(", ")}] target=[${[...target].join(", ")}] missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`
    );

    if (APPLY) {
      for (const g of missing) {
        await db.execute(sql`
          INSERT INTO product_grades (product_id, grade) VALUES (${productId}, ${g})
          ON CONFLICT DO NOTHING
        `);
      }
      for (const g of extra) {
        await db.execute(sql`
          DELETE FROM product_grades
           WHERE product_id = ${productId} AND grade = ${g}
        `);
      }
    }
    totalAdded += missing.length;
    totalRemoved += extra.length;
  }

  console.log("\n=== summary ===");
  console.log(`mode:               ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`items processed:    ${processed}`);
  console.log(`skipped no grade:   ${skippedNoGrade}`);
  console.log(`skipped no product: ${skippedNoProduct}`);
  console.log(`products w/ delta:  ${touched}`);
  console.log(`rows added:         ${totalAdded}`);
  console.log(`rows removed:       ${totalRemoved}`);
  if (!APPLY) console.log("\nrerun with --apply to write changes.");
  if (APPLY) {
    console.log(
      "\n⚠  Restart the deploy app to flush Next.js unstable_cache:\n" +
        "   docker restart inventre-deploy-app"
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
