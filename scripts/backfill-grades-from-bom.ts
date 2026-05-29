/* eslint-disable no-console */
/**
 * PASS 1 — Self-grade
 *   For every product, run extractGrade(name) and write a product_grades row
 *   if the name itself encodes a grade (e.g. "Sparsh Grade 9").
 *
 * PASS 2 — Inherit via BOM walk (DISABLED by default)
 *   Used to copy a parent Magic Box / Bookkit grade onto every reachable
 *   leaf. That's wrong: leaves carry their own `custom_grade` in ERP (the
 *   Uniform Grade), and a Magic Box for school-Grade 6 (uniform Grade 9)
 *   can legitimately contain a uniform item also used by school-Grade 9
 *   (uniform Grade 12). Inheriting the parent grade then misfires the shop
 *   filter (e.g. a Grade-9 student sees Class-9-10 pants).
 *
 *   Pass `--inherit-grades` to re-enable for forensic backfills only.
 *
 * PASS 3 — School scoping
 *   Same recursive walk but for school_code: derive school from the Magic Box
 *   prefix (e.g. "WM JK Magic Box Girls Grade 9" → schools matching WM JK)
 *   and propagate to all reachable leaves via product_school. Still on by
 *   default — this is independent of grade and is what the shop uses to
 *   know which schools an item appears for.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING for the link tables, and re-runs
 * are cheap.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";
import { extractGrade, type CanonicalGrade } from "../lib/grade";

type ProductRow = {
  id: string;
  name: string;
  bundle_level: "magic_box" | "bookkit" | "sub_bundle" | "leaf" | null;
  bundle_gender: string | null;
};

/** BOM-prefix → schools.school_code map. CAS LR / CAS NIB map to BOTH their
 *  CBSE+CIE streams (Magic Box is shared across boards at those schools).
 *  This table is hand-tuned because the BOM uses human prefixes while
 *  school_code is the legacy ERPNext shortcode. */
const PREFIX_TO_CODES: Array<[RegExp, string[]]> = [
  // Most specific first (longer prefixes win via sort below)
  [/^WM\s+WF\b/i, ["WMAWF"]],
  [/^WM\s+JK\b/i, ["WMAJK"]],
  [/^WNWFB?\b/i, ["WMAWF"]],
  [/^WNJKB?\b/i, ["WMAJK"]],
  [/^SAS\s+KS\b/i, ["SASKS"]],
  [/^SASKS\b/i, ["SASKS"]],
  [/^SAS\s+BP\b/i, ["SASBP"]],
  [/^SASBP\b/i, ["SASBP"]],
  [/^SAS\s+SC\b/i, ["SASBP", "sassu"]],
  [/^SASSC\b/i, ["SASBP", "sassu"]],
  [/^SAS\s+KEE\b/i, ["SASKEE"]],
  [/^SASKEE\b/i, ["SASKEE"]],
  // Catch the long-form Keesara/Suchitra names — these used to fall through
  // to the ^SAS\b fallback and get wrongly tagged for SASBP. The bookkit
  // names ("SAS Keesara Grade 11 Bookkit", "SAS Suchitra Grade 11 Bookkit")
  // are the obvious examples. Must come BEFORE the bare ^SAS fallback.
  [/^SAS\s+Keesara\b/i, ["SASKS"]],
  [/^SAS\s+Suchitra\b/i, ["SASBP"]],
  [/^SAS\b/i, ["SASBP"]], // fallback (kept narrow — only matches when none of the longer-form rules above hit)
  [/^CAS\s+LR\b/i, ["CASLRCBSE", "CASLRCIE"]],
  [/^CAS\s+NIB\b/i, ["CASNIBMCBSE", "CASNIBMCIE"]],
  [/^CAS\s+CBS\b/i, ["CASLRCBSE", "CASNIBMCBSE"]],
  [/^CAS\s+CIE\b/i, ["CASLRCIE", "CASNIBMCIE"]],
  [/^SMS\s+GRA\b/i, ["SMSAW"]],
  [/^SMS\b/i, ["SMSAW"]],
  [/^TSUSC\b/i, ["TSUSC"]],
  [/^TSUS\b/i, ["TSUSC"]],
  [/^YIPS\b/i, ["YIPS"]],
  [/^TTT\s+LR\b/i, ["TTTLR"]],
  [/^TTT\s+NIB\b/i, ["TTTNIBM"]],
  [/^TTT\s+PN\b/i, ["TTTPN"]],
  [/^TTT\s+UKG\b/i, ["TTTLR", "TTTNIBM", "TTTPN"]],
  [/^TTT\s+LKG\b/i, ["TTTLR", "TTTNIBM", "TTTPN"]],
  [/^TTT\b/i, ["TTTLR", "TTTNIBM", "TTTPN"]],
];

async function loadSchoolCodes(): Promise<Map<string, string>> {
  const rows = (await db.execute(sql`
    SELECT school_code AS code, id FROM schools WHERE school_code IS NOT NULL
  `)) as unknown as { code: string; id: string }[];
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.code, r.id);
  return m;
}

/** Returns 0..N matching school ids. Multi-match supports CAS LR → CBSE+CIE. */
function matchSchools(name: string, codeMap: Map<string, string>): string[] {
  for (const [re, codes] of PREFIX_TO_CODES) {
    if (re.test(name)) {
      const ids: string[] = [];
      for (const code of codes) {
        const id = codeMap.get(code);
        if (id) ids.push(id);
      }
      if (ids.length) return ids;
    }
  }
  return [];
}

async function loadProducts(): Promise<Map<string, ProductRow>> {
  const rows = (await db.execute(sql`
    SELECT id, name, bundle_level::text AS bundle_level, bundle_gender
      FROM products
  `)) as unknown as ProductRow[];
  const map = new Map<string, ProductRow>();
  for (const r of rows) map.set(r.id, r);
  return map;
}

async function loadComponents(): Promise<Map<string, string[]>> {
  // bundle parent product → array of child product ids
  const rows = (await db.execute(sql`
    SELECT pb.product_id AS parent_id, bc.product_id AS child_id
      FROM bundle_components bc
      JOIN product_bundles pb ON pb.id = bc.bundle_id
     WHERE bc.product_id IS NOT NULL
  `)) as unknown as { parent_id: string; child_id: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const arr = map.get(r.parent_id) ?? [];
    arr.push(r.child_id);
    map.set(r.parent_id, arr);
  }
  return map;
}

function walkLeaves(
  rootId: string,
  edges: Map<string, string[]>,
  products: Map<string, ProductRow>,
  seen = new Set<string>()
): string[] {
  if (seen.has(rootId)) return [];
  seen.add(rootId);
  const children = edges.get(rootId) ?? [];
  if (children.length === 0) return [rootId];
  const out: string[] = [];
  for (const c of children) {
    const cp = products.get(c);
    if (!cp) continue;
    if (cp.bundle_level === "leaf") out.push(c);
    out.push(...walkLeaves(c, edges, products, seen));
  }
  return out;
}

const INHERIT_GRADES = process.argv.includes("--inherit-grades");
const SELF_GRADE = process.argv.includes("--self-grade");

async function main() {
  console.log(
    `Mode: PASS 1 (self-grade from name) ${SELF_GRADE ? "enabled" : "disabled"}; PASS 2 (BOM inheritance) ${INHERIT_GRADES ? "enabled" : "disabled"}; PASS 3 (school propagation) always on.`
  );
  if (!SELF_GRADE && !INHERIT_GRADES) {
    console.log(
      "(default: ERP custom_grade is the only authoritative source. Use --self-grade or --inherit-grades for forensic backfills only.)"
    );
  }
  console.log("Loading products + components + schools...");
  const productsMap = await loadProducts();
  const edges = await loadComponents();
  const codeMap = await loadSchoolCodes();
  console.log(`  ${productsMap.size} products, ${edges.size} bundle parents, ${codeMap.size} schools`);

  // PASS 1 — Self grade (opt-in)
  let pass1Wrote = 0;
  for (const p of productsMap.values()) {
    if (!SELF_GRADE) continue;
    const g = extractGrade(p.name);
    if (!g) continue;
    await db.execute(sql`
      INSERT INTO product_grades (product_id, grade)
      VALUES (${p.id}, ${g})
      ON CONFLICT DO NOTHING
    `);
    pass1Wrote++;
  }
  console.log(`PASS 1 (self): wrote ${pass1Wrote} grade rows`);

  // PASS 2 + 3 — propagate from each root (magic_box / bookkit) to all reachable leaves
  let pass2Wrote = 0;
  let pass3Wrote = 0;
  let bundleConfigsWrote = 0;

  for (const p of productsMap.values()) {
    if (p.bundle_level !== "magic_box" && p.bundle_level !== "bookkit") continue;
    const grade = extractGrade(p.name);
    if (!grade) continue;
    const schoolIds = matchSchools(p.name, codeMap);

    // collect leaves
    const leaves = walkLeaves(p.id, edges, productsMap);

    // PASS 2: only run when explicitly opted in; otherwise leaves keep
    // the grades the ERP feed gave them. PASS 3 (school propagation) still
    // runs unconditionally — that part isn't the source of the mis-tagging.
    for (const leafId of leaves) {
      if (INHERIT_GRADES) {
        await db.execute(sql`
          INSERT INTO product_grades (product_id, grade)
          VALUES (${leafId}, ${grade})
          ON CONFLICT DO NOTHING
        `);
        pass2Wrote++;
      }
      for (const schoolId of schoolIds) {
        await db.execute(sql`
          INSERT INTO product_school (product_id, school_id)
          VALUES (${leafId}, ${schoolId})
          ON CONFLICT DO NOTHING
        `);
        pass3Wrote++;
      }
    }

    // For Magic Box roots: register in bundle_configs so the shop can look up
    // "give me the magic box for school+grade".
    if (p.bundle_level === "magic_box" && schoolIds.length) {
      const bundleRows = (await db.execute(sql`
        SELECT id FROM product_bundles WHERE product_id = ${p.id} LIMIT 1
      `)) as unknown as { id: string }[];
      const bundleId = bundleRows[0]?.id;
      if (bundleId) {
        for (const schoolId of schoolIds) {
          await db.execute(sql`
            INSERT INTO bundle_configs (school_id, grade, bundle_id, is_active)
            VALUES (${schoolId}, ${grade}, ${bundleId}, true)
            ON CONFLICT (school_id, grade, bundle_id) DO UPDATE
              SET is_active = true
          `);
          bundleConfigsWrote++;
        }
      }
      // Also link the Magic Box product itself to its schools
      for (const schoolId of schoolIds) {
        await db.execute(sql`
          INSERT INTO product_school (product_id, school_id)
          VALUES (${p.id}, ${schoolId})
          ON CONFLICT DO NOTHING
        `);
      }
    }
  }
  console.log(`PASS 2 (grade-from-parent): wrote ${pass2Wrote} grade rows`);
  console.log(`PASS 3 (school-from-parent): wrote ${pass3Wrote} school rows`);
  console.log(`Magic Box bundle_configs: ${bundleConfigsWrote} rows`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
