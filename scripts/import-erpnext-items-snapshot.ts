/* eslint-disable no-console */
/**
 * Rebuild product_school + product_grades from the :8443 ERPNext clone snapshot.
 *
 * Source: data/erpnext-items-snapshot.json (written by dump-erpnext-items.ts).
 *
 * Behaviour:
 *   1. Safety gate: refuse unless a fresh backup exists at
 *      /root/inventre-final-backup/pre-shop-rebuild-*.sql.gz (≤ 6 h old).
 *   2. Load snapshot. Build (code → item) map.
 *   3. Resolve effective school/grade per item by walking `variant_of` up
 *      to the parent template when the variant's own field is empty.
 *   4. Wipe product_school + product_grades for products where
 *      erp_name IS NOT NULL. Synthetic Magic Box / sub_bundle / bookkit
 *      rows (erp_name IS NULL) are left alone — they get re-tagged later
 *      via the BOM-walk scripts.
 *   5. Rebuild:
 *        - product_school     ← schools.school_code lookup from
 *                                "<CODE>-<Display>" prefix.
 *        - product_grades     ← each canonical grade in custom_grade, after
 *                                erpGradeToReal() offset translation.
 *   6. Touch products.lastErpSyncAt so the row reflects this run.
 *   7. Print audit summary.
 *
 * Run:
 *   DATABASE_URL=postgres://inventre:inventre_prod@localhost:55433/inventre \
 *     npx tsx scripts/import-erpnext-items-snapshot.ts
 *
 * Idempotent: re-running with the same snapshot is a no-op.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import fs from "fs";
import { db } from "../db/client";
import { sql } from "drizzle-orm";
import { canonicalGrade } from "../lib/grade";
import { erpGradeToReal } from "../lib/grade-translate";

type ErpItem = {
  name: string;
  item_name: string;
  item_group: string | null;
  custom_school_name: string | null;
  custom_grade: string | null;
  custom_gender: string | null;
  variant_of: string | null;
  has_variants: boolean;
  published_in_website: boolean;
  // Frappe `disabled` flag isn't surfaced by the dashboard list endpoint;
  // we trust the row's presence as "active".
};

type Snapshot = {
  fetched_at: string;
  source: string;
  items: ErpItem[];
};

const MAX_BACKUP_AGE_HOURS = 6;
const BACKUP_DIR = "/root/inventre-final-backup";
const BACKUP_PREFIX = "pre-shop-rebuild-";

function freshBackupExists(): { path: string; ageHours: number } | null {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const cands = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(".sql.gz"))
    .map((f) => {
      const fp = path.join(BACKUP_DIR, f);
      const st = fs.statSync(fp);
      return { path: fp, mtime: st.mtimeMs, size: st.size };
    })
    // 100 KiB floor protects against the empty-gzip footgun
    .filter((c) => c.size > 100 * 1024)
    .sort((a, b) => b.mtime - a.mtime);
  if (cands.length === 0) return null;
  const ageHours = (Date.now() - cands[0].mtime) / 3_600_000;
  if (ageHours > MAX_BACKUP_AGE_HOURS) return null;
  return { path: cands[0].path, ageHours };
}

function parseSchoolCode(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^([^-]+)-/);
  return m ? m[1].trim() : raw.trim();
}

function splitGrades(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

/** ERPNext custom_grade values are in ERP-offset numbering (Grade N = real N-3). */
function toCanonicalGrades(raw: string | null): string[] {
  const out = new Set<string>();
  for (const g of splitGrades(raw)) {
    const real = erpGradeToReal(g);
    if (real) {
      const canon = canonicalGrade(real);
      if (canon) out.add(canon);
    }
  }
  return [...out];
}

type Effective = {
  schoolCode: string | null;
  gradesCanon: string[];
};

function resolveEffective(
  code: string,
  byName: Map<string, ErpItem>,
  seen: Set<string> = new Set()
): Effective {
  if (seen.has(code)) return { schoolCode: null, gradesCanon: [] };
  seen.add(code);
  const it = byName.get(code);
  if (!it) return { schoolCode: null, gradesCanon: [] };
  const ownSchool = parseSchoolCode(it.custom_school_name);
  const ownGrades = toCanonicalGrades(it.custom_grade);
  if (ownSchool && ownGrades.length > 0) {
    return { schoolCode: ownSchool, gradesCanon: ownGrades };
  }
  if (!it.variant_of) return { schoolCode: ownSchool, gradesCanon: ownGrades };
  const parent = resolveEffective(it.variant_of, byName, seen);
  return {
    schoolCode: ownSchool ?? parent.schoolCode,
    gradesCanon: ownGrades.length > 0 ? ownGrades : parent.gradesCanon,
  };
}

async function main() {
  // 1) Safety gate
  const backup = freshBackupExists();
  if (!backup) {
    console.error(
      `✗ Refusing to run without a fresh backup. Take one with:\n` +
        `  docker exec -i inventre-deploy-postgres pg_dump -U inventre -d inventre --no-owner --no-privileges \\\n` +
        `    | gzip > ${BACKUP_DIR}/${BACKUP_PREFIX}$(date +%Y%m%d-%H%M%S).sql.gz`
    );
    process.exit(2);
  }
  console.log(`✓ Backup: ${backup.path} (${backup.ageHours.toFixed(2)}h old)`);

  // 2) Load snapshot
  const snapPath = path.resolve(process.cwd(), "data/erpnext-items-snapshot.json");
  if (!fs.existsSync(snapPath)) {
    console.error(`✗ Missing snapshot ${snapPath}. Run scripts/dump-erpnext-items.ts first.`);
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8")) as Snapshot;
  console.log(`Loaded snapshot fetched=${snap.fetched_at} items=${snap.items.length}`);
  const byName = new Map<string, ErpItem>();
  for (const it of snap.items) byName.set(it.name, it);

  // 3) Resolve effective school/grade per item
  type Resolved = { name: string; schoolCode: string | null; grades: string[] };
  const resolved: Resolved[] = [];
  for (const it of snap.items) {
    const eff = resolveEffective(it.name, byName);
    resolved.push({ name: it.name, schoolCode: eff.schoolCode, grades: eff.gradesCanon });
  }
  const withSchool = resolved.filter((r) => r.schoolCode).length;
  const withGrade = resolved.filter((r) => r.grades.length > 0).length;
  console.log(`After resolve: withSchool=${withSchool} withGrade=${withGrade}`);

  // 4) Load lookup caches
  const schoolRows = (await db.execute(sql`
    SELECT school_code, id FROM schools WHERE school_code IS NOT NULL
  `)) as unknown as { school_code: string; id: string }[];
  const schoolByCode = new Map<string, string>();
  for (const s of schoolRows) schoolByCode.set(s.school_code, s.id);
  console.log(`Loaded ${schoolByCode.size} schools`);

  const productRows = (await db.execute(sql`
    SELECT id, name, erp_name FROM products WHERE erp_name IS NOT NULL
  `)) as unknown as { id: string; name: string; erp_name: string | null }[];
  const productByErpName = new Map<string, string>();
  const productByName = new Map<string, string>();
  for (const p of productRows) {
    if (p.erp_name) productByErpName.set(p.erp_name, p.id);
    productByName.set(p.name.toLowerCase(), p.id);
  }
  console.log(`Loaded ${productRows.length} ERP-linked products`);

  // 5) WIPE phase — only rows owned by ERP-linked products
  console.log("Wiping product_school + product_grades for erp_name IS NOT NULL …");
  const before = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM product_school)  AS ps_total,
      (SELECT COUNT(*) FROM product_grades)  AS pg_total
  `)) as unknown as { ps_total: string; pg_total: string }[];
  console.log(`  before: product_school=${before[0].ps_total} product_grades=${before[0].pg_total}`);

  await db.execute(sql`
    DELETE FROM product_school
     WHERE product_id IN (SELECT id FROM products WHERE erp_name IS NOT NULL)
  `);
  await db.execute(sql`
    DELETE FROM product_grades
     WHERE product_id IN (SELECT id FROM products WHERE erp_name IS NOT NULL)
  `);

  // 6) REBUILD
  let schoolLinks = 0;
  let gradeLinks = 0;
  let unmatchedProduct = 0;
  const missingSchools = new Map<string, number>();
  const droppedNoCanonGrade = new Map<string, number>();

  // Pre-compute dropped grade tracker (count raw values that couldn't translate)
  for (const r of resolved) {
    const it = byName.get(r.name);
    if (!it) continue;
    if (r.grades.length === 0 && it.custom_grade) {
      const tag = it.custom_grade;
      droppedNoCanonGrade.set(tag, (droppedNoCanonGrade.get(tag) ?? 0) + 1);
    }
  }

  for (const r of resolved) {
    const productId =
      productByErpName.get(r.name) ?? productByName.get(r.name.toLowerCase());
    if (!productId) {
      unmatchedProduct++;
      continue;
    }

    if (r.schoolCode) {
      const schoolId = schoolByCode.get(r.schoolCode);
      if (schoolId) {
        await db.execute(sql`
          INSERT INTO product_school (product_id, school_id)
          VALUES (${productId}, ${schoolId})
          ON CONFLICT DO NOTHING
        `);
        schoolLinks++;
      } else {
        missingSchools.set(r.schoolCode, (missingSchools.get(r.schoolCode) ?? 0) + 1);
      }
    }

    if (r.grades.length > 0) {
      for (const g of r.grades) {
        await db.execute(sql`
          INSERT INTO product_grades (product_id, grade)
          VALUES (${productId}, ${g})
          ON CONFLICT DO NOTHING
        `);
        gradeLinks++;
      }
    }
  }

  // 7) Touch lastErpSyncAt for everything we processed
  await db.execute(sql`
    UPDATE products SET last_erp_sync_at = NOW()
     WHERE erp_name IS NOT NULL
  `);

  const after = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM product_school)  AS ps_total,
      (SELECT COUNT(*) FROM product_grades)  AS pg_total
  `)) as unknown as { ps_total: string; pg_total: string }[];
  console.log(`  after:  product_school=${after[0].ps_total} product_grades=${after[0].pg_total}`);

  // 8) Audit
  console.log("\n── Audit ──────────────────────────────────────");
  console.log(`Items processed:        ${resolved.length}`);
  console.log(`School links inserted:  ${schoolLinks}`);
  console.log(`Grade links inserted:   ${gradeLinks}`);
  console.log(`Unmatched products:     ${unmatchedProduct} (item not in products.erp_name nor products.name)`);
  if (missingSchools.size > 0) {
    console.log(`Missing schools (code → item count):`);
    for (const [c, n] of [...missingSchools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${c}: ${n}`);
    }
  }
  if (droppedNoCanonGrade.size > 0) {
    console.log(`Dropped grade tags (couldn't canonicalise → item count):`);
    for (const [g, n] of [...droppedNoCanonGrade.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${JSON.stringify(g)}: ${n}`);
    }
  }
  console.log("───────────────────────────────────────────────");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
