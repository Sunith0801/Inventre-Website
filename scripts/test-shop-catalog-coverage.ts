/* eslint-disable no-console */
/**
 * Full-coverage shop catalog test.
 *
 * 1. Enumerate every distinct (school, class, gender) the students table
 *    actually has — these are the combos the shop must serve.
 * 2. For each, pick a representative student so the user can spot-verify
 *    in the live site.
 * 3. Replicate `lib/repos/products.ts:listProductsForStudent()` in pure SQL,
 *    running BOTH the returning-student path (Magic Box children excl
 *    bookkit) and the new-student path (Magic Box + all children).
 * 4. Cross-check against the :8443 ERPNext snapshot — count items tagged
 *    for that (school, canonical grade) so we can flag combos where the
 *    upstream has products but our shop returns zero.
 * 5. Classify each combo and emit:
 *      - human summary to stdout
 *      - data/shop-coverage-report.csv (one row per combo)
 *      - data/shop-coverage-fails.txt (drilldown for every FAIL)
 *
 * Pure read-only. Run:
 *   DATABASE_URL=postgres://inventre:inventre_prod@localhost:55433/inventre \
 *     npx tsx scripts/test-shop-catalog-coverage.ts
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import fs from "fs";
import postgres from "postgres";
import { erpGradeToReal } from "../lib/grade-translate";
import { canonicalGrade } from "../lib/grade";

const DB_URL =
  process.env.DATABASE_URL ?? "postgres://inventre:inventre_prod@localhost:55433/inventre";

const sql = postgres(DB_URL, { max: 4, prepare: false });

type Combo = {
  school_id: string;
  school_code: string;
  school_name: string;
  class: string | null;
  gender: string | null;
  student_count: number;
  sample_student: string;
  sample_phone: string | null;
};

type Row = Combo & {
  canonical_grade: string | null;
  bundle_gender: "Boys" | "Girls" | null;
  magic_box: boolean;
  items_returning: number;
  items_new: number;
  erp_items: number;
  status: string;
  notes: string;
};

function parseSchoolCode(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^([^-]+)-/);
  return m ? m[1].trim() : raw.trim();
}

async function main() {
  // ── ERP snapshot index: (schoolCode, canonicalGrade) → item count ──
  const snapPath = path.resolve(process.cwd(), "data/erpnext-items-snapshot.json");
  if (!fs.existsSync(snapPath)) {
    console.error("Missing data/erpnext-items-snapshot.json");
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8")) as {
    items: Array<{ custom_school_name: string | null; custom_grade: string | null }>;
  };
  const erpIndex = new Map<string, number>();
  let snapUnmappable = 0;
  for (const it of snap.items) {
    const code = parseSchoolCode(it.custom_school_name);
    if (!code) {
      snapUnmappable++;
      continue;
    }
    if (!it.custom_grade) continue;
    for (const raw of it.custom_grade.split(",").map((s) => s.trim()).filter(Boolean)) {
      const real = erpGradeToReal(raw);
      if (!real) continue;
      const canon = canonicalGrade(real);
      if (!canon) continue;
      const key = `${code}|${canon}`;
      erpIndex.set(key, (erpIndex.get(key) ?? 0) + 1);
    }
  }
  console.log(
    `ERP snapshot: ${snap.items.length} items indexed into ${erpIndex.size} (school, grade) buckets (${snapUnmappable} items had no parseable school code)`
  );

  // ── Enumerate combos with one representative student per combo ──
  const combos = (await sql<Combo[]>`
    WITH ranked AS (
      SELECT s.school_id, sch.school_code, sch.name AS school_name,
             s.class, s.gender, s.name AS student_name,
             p.phone AS parent_phone,
             ROW_NUMBER() OVER (PARTITION BY s.school_id, s.class, s.gender
                                ORDER BY s.name) AS rn,
             COUNT(*) OVER (PARTITION BY s.school_id, s.class, s.gender)::int AS cnt
        FROM students s
        JOIN schools sch ON sch.id = s.school_id
        LEFT JOIN parents p ON p.id = s.parent_id
    )
    SELECT school_id, school_code, school_name, class, gender,
           cnt AS student_count,
           student_name AS sample_student,
           parent_phone AS sample_phone
      FROM ranked
     WHERE rn = 1
     ORDER BY school_code, class, gender
  `) as unknown as Combo[];
  console.log(`Enumerated ${combos.length} (school, class, gender) combos with students`);

  // ── Per-combo test ──
  const rows: Row[] = [];
  let pass = 0,
    warnLow = 0,
    failZero = 0,
    failGap = 0,
    skipGender = 0,
    skipGrade = 0;
  const failDrill: string[] = [];

  for (const c of combos) {
    // Replicate session.ts:143 translation
    const translated = erpGradeToReal(c.class) ?? c.class;
    const canon = canonicalGrade(translated);
    const bundleGender: "Boys" | "Girls" | null =
      c.gender === "Female" ? "Girls" : c.gender === "Male" ? "Boys" : null;

    const erpCount = canon ? erpIndex.get(`${c.school_code}|${canon}`) ?? 0 : 0;

    const baseRow: Row = {
      ...c,
      canonical_grade: canon,
      bundle_gender: bundleGender,
      magic_box: false,
      items_returning: 0,
      items_new: 0,
      erp_items: erpCount,
      status: "",
      notes: "",
    };

    if (!bundleGender) {
      baseRow.status = "SKIP_NO_GENDER";
      baseRow.notes = `gender=${c.gender ?? "NULL"} (shop returns 400)`;
      skipGender++;
      rows.push(baseRow);
      continue;
    }
    if (!canon) {
      baseRow.status = "SKIP_BAD_GRADE";
      baseRow.notes = `class=${c.class ?? "NULL"} → translate=${translated ?? "NULL"} → canon=null (shop returns 400)`;
      skipGrade++;
      rows.push(baseRow);
      continue;
    }

    // Roots-only shop query (replicates lib/repos/products.ts:listProductsForStudent
    // after the 2026-05-21 "main items only" refinement: hide products that
    // are children of another product in the same catalog).
    const flat = (await sql`
      WITH catalog AS (
        SELECT p.id FROM products p
          JOIN product_school ps ON ps.product_id = p.id AND ps.school_id = ${c.school_id}
          JOIN product_grades pg ON pg.product_id = p.id AND pg.grade = ${canon}
         WHERE p.status='active' AND p.is_variant_item = false
           AND p.bundle_level IN ('leaf','bookkit','sub_bundle')
           AND (p.bundle_gender IS NULL OR p.bundle_gender = ${bundleGender})
      ),
      contained AS (
        SELECT DISTINCT bc.product_id AS id
          FROM bundle_components bc
          JOIN product_bundles pb ON pb.id = bc.bundle_id
         WHERE pb.product_id IN (SELECT id FROM catalog) AND bc.product_id IS NOT NULL
      )
      SELECT COUNT(*)::int AS n FROM catalog WHERE id NOT IN (SELECT id FROM contained)
    `) as unknown as { n: number }[];
    const items = flat[0].n;
    // Magic Box flag retained in the report as informational only — it no
    // longer affects what the shop returns.
    const mb = (await sql`
      SELECT 1 FROM products p
        JOIN product_school ps ON ps.product_id = p.id AND ps.school_id = ${c.school_id}
        JOIN product_grades pg ON pg.product_id = p.id AND pg.grade = ${canon}
       WHERE p.status='active'
         AND p.bundle_level = 'magic_box'
         AND p.bundle_gender = ${bundleGender}
       LIMIT 1
    `) as unknown as { n: number }[];
    baseRow.magic_box = mb.length > 0;
    baseRow.items_returning = items;
    baseRow.items_new = items;
    const returning = items;
    const newStudent = items;

    // Classification
    if (returning === 0 && newStudent === 0) {
      if (erpCount > 0) {
        baseRow.status = "FAIL_GAP";
        baseRow.notes = `ERP has ${erpCount} items at this (school, grade) but shop returns 0`;
        failGap++;
      } else {
        baseRow.status = "FAIL_ZERO";
        baseRow.notes = `No items anywhere (ERP also has 0 for this school+grade) — upstream gap`;
        failZero++;
      }
      failDrill.push(
        `${c.school_code} / ${canon} / ${bundleGender}  ` +
          `students=${c.student_count}  sample="${c.sample_student}"  ` +
          `erp=${erpCount}  magicBox=${baseRow.magic_box}  ${baseRow.status}`
      );
    } else if (returning < 3) {
      baseRow.status = "WARN_LOW";
      baseRow.notes = `only ${returning} items in returning-student path`;
      warnLow++;
    } else {
      baseRow.status = "PASS";
      pass++;
    }
    rows.push(baseRow);
  }

  // ── Output ──
  const csvLines = [
    [
      "school_code",
      "school_name",
      "class_raw",
      "canonical_grade",
      "gender",
      "bundle_gender",
      "student_count",
      "sample_student",
      "sample_phone",
      "magic_box",
      "items_returning",
      "items_new",
      "erp_items",
      "status",
      "notes",
    ].join(","),
  ];
  for (const r of rows) {
    csvLines.push(
      [
        r.school_code,
        JSON.stringify(r.school_name ?? ""),
        JSON.stringify(r.class ?? ""),
        r.canonical_grade ?? "",
        r.gender ?? "",
        r.bundle_gender ?? "",
        r.student_count,
        JSON.stringify(r.sample_student ?? ""),
        r.sample_phone ?? "",
        r.magic_box,
        r.items_returning,
        r.items_new,
        r.erp_items,
        r.status,
        JSON.stringify(r.notes),
      ].join(",")
    );
  }
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/shop-coverage-report.csv", csvLines.join("\n"));
  fs.writeFileSync(
    "data/shop-coverage-fails.txt",
    failDrill.length === 0 ? "no failures\n" : failDrill.join("\n") + "\n"
  );

  // ── Summary ──
  console.log("\n══ Coverage Summary ══════════════════════════════");
  console.log(`Total combos:            ${combos.length}`);
  console.log(`  PASS                  : ${pass}`);
  console.log(`  WARN_LOW (<3 items)   : ${warnLow}`);
  console.log(`  FAIL_GAP (erp>0 shop=0): ${failGap}`);
  console.log(`  FAIL_ZERO (no items anywhere): ${failZero}`);
  console.log(`  SKIP_NO_GENDER        : ${skipGender}`);
  console.log(`  SKIP_BAD_GRADE        : ${skipGrade}`);
  console.log("\nReport: data/shop-coverage-report.csv");
  console.log("Fails:  data/shop-coverage-fails.txt");

  // Per-school summary
  const bySchool = new Map<string, { pass: number; fail: number; warn: number; skip: number; combos: number }>();
  for (const r of rows) {
    const k = r.school_code;
    const v = bySchool.get(k) ?? { pass: 0, fail: 0, warn: 0, skip: 0, combos: 0 };
    v.combos++;
    if (r.status === "PASS") v.pass++;
    else if (r.status.startsWith("FAIL")) v.fail++;
    else if (r.status === "WARN_LOW") v.warn++;
    else v.skip++;
    bySchool.set(k, v);
  }
  console.log("\nPer-school:");
  const schoolKeys = [...bySchool.keys()].sort();
  for (const k of schoolKeys) {
    const v = bySchool.get(k)!;
    const tag =
      v.fail > 0 ? "✗" : v.warn > 0 ? "!" : v.skip > 0 && v.pass === 0 ? "·" : "✓";
    console.log(
      `  ${tag} ${k.padEnd(10)} combos=${String(v.combos).padStart(3)}  ` +
        `PASS=${String(v.pass).padStart(3)}  WARN=${String(v.warn).padStart(3)}  ` +
        `FAIL=${String(v.fail).padStart(3)}  SKIP=${String(v.skip).padStart(3)}`
    );
  }

  if (failDrill.length > 0) {
    console.log(`\n── First 30 FAIL combos ──`);
    for (const line of failDrill.slice(0, 30)) console.log(`  ${line}`);
    if (failDrill.length > 30) console.log(`  …(+${failDrill.length - 30} more — see data/shop-coverage-fails.txt)`);
  }

  await sql.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
