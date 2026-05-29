/* eslint-disable no-console */
/**
 * Use Item (1).csv as the canonical source for (item → school, item → grade).
 *
 *   • "School Name" column is "<school_code>-<display name>" (e.g. "WMAWF-Winmore Academy Whitefield")
 *     → directly resolves to schools.school_code.
 *
 *   • "Variant Of" lets variants inherit their template's school/grade. Walked
 *     transitively (variants of variants resolve to the root).
 *
 *   • "Grade (Organization Grade)" is the school-facing grade name. We trust
 *     this. "Grade (Uniform Grade)" is internal ERPNext numbering ("Grade 14"
 *     for a Grade 11 textbook) — IGNORED.
 *
 * Effect: ADDS rows to product_school + product_grades where the CSV says so.
 * Existing rows (from BOM walk + prefix regex) are left intact (ON CONFLICT
 * DO NOTHING). Idempotent.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import fs from "fs";
import { db } from "../db/client";
import { sql } from "drizzle-orm";
import { canonicalGrade } from "../lib/grade";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c === "\r") {
        // skip
      } else cell += c;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

type ItemRow = {
  code: string;
  name: string;
  schoolCode: string | null;
  variantOf: string | null;
  orgGrade: string | null;
  gender: string | null;
  disabled: boolean;
};

function parseSchoolCode(raw: string | undefined): string | null {
  if (!raw) return null;
  // Format: "<CODE>-<Display Name>"
  const m = raw.match(/^([^-]+)-/);
  return m ? m[1].trim() : raw.trim();
}

async function main() {
  const csvPath = path.resolve(process.cwd(), "Item (1).csv");
  if (!fs.existsSync(csvPath)) {
    console.error("Missing Item (1).csv in project root");
    process.exit(1);
  }
  console.log("Reading", csvPath);
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const hdr = rows[0];
  const ix = (h: string) => hdr.indexOf(h);

  const cCode = ix("Item Code"),
    cName = ix("Item Name"),
    cSchool = ix("School Name"),
    cVariant = ix("Variant Of"),
    cOrgGrade = ix("Grade (Organization Grade)"),
    cGender = ix("Gender"),
    cDisabled = ix("Disabled");

  const byCode = new Map<string, ItemRow>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const code = r[cCode]?.trim();
    if (!code) continue;
    if (byCode.has(code)) continue; // first row wins
    byCode.set(code, {
      code,
      name: r[cName]?.trim() ?? code,
      schoolCode: parseSchoolCode(r[cSchool]),
      variantOf: r[cVariant]?.trim() || null,
      orgGrade: r[cOrgGrade]?.trim() || null,
      gender: r[cGender]?.trim() || null,
      disabled: r[cDisabled]?.trim() === "1",
    });
  }
  console.log(`Loaded ${byCode.size} distinct items`);

  // Walk Variant Of chain to find effective school/grade/gender for variants.
  function resolveEffective(code: string, seen = new Set<string>()): ItemRow | null {
    if (seen.has(code)) return null;
    seen.add(code);
    const it = byCode.get(code);
    if (!it) return null;
    if (it.schoolCode && it.orgGrade) return it;
    if (!it.variantOf) return it;
    const parent = resolveEffective(it.variantOf, seen);
    if (!parent) return it;
    return {
      ...it,
      schoolCode: it.schoolCode ?? parent.schoolCode,
      orgGrade: it.orgGrade ?? parent.orgGrade,
      gender: it.gender ?? parent.gender,
    };
  }

  // Build code → resolved
  const resolved = new Map<string, ItemRow>();
  for (const code of byCode.keys()) {
    const r = resolveEffective(code);
    if (r) resolved.set(code, r);
  }

  // Stats after resolution
  let withSchool = 0,
    withGrade = 0;
  for (const r of resolved.values()) {
    if (r.schoolCode) withSchool++;
    if (r.orgGrade && canonicalGrade(r.orgGrade)) withGrade++;
  }
  console.log(`After Variant-Of walk: ${withSchool} with school, ${withGrade} with grade`);

  // Load school code → id and existing products by name
  const schoolRows = (await db.execute(sql`
    SELECT school_code, id FROM schools WHERE school_code IS NOT NULL
  `)) as unknown as { school_code: string; id: string }[];
  const schoolByCode = new Map<string, string>();
  for (const s of schoolRows) schoolByCode.set(s.school_code, s.id);
  console.log(`Loaded ${schoolByCode.size} schools`);

  const productRows = (await db.execute(sql`
    SELECT id, name, erp_name FROM products
  `)) as unknown as { id: string; name: string; erp_name: string | null }[];
  const productByName = new Map<string, string>();
  for (const p of productRows) {
    productByName.set(p.name.toLowerCase(), p.id);
    if (p.erp_name) productByName.set(p.erp_name.toLowerCase(), p.id);
  }
  console.log(`Loaded ${productRows.length} products`);

  // Apply
  let schoolLinks = 0;
  let gradeLinks = 0;
  let unmatchedProduct = 0;
  let missingSchool = 0;

  for (const item of resolved.values()) {
    if (item.disabled) continue;
    const productId =
      productByName.get(item.code.toLowerCase()) ??
      productByName.get(item.name.toLowerCase());
    if (!productId) {
      unmatchedProduct++;
      continue;
    }

    if (item.schoolCode) {
      const schoolId = schoolByCode.get(item.schoolCode);
      if (schoolId) {
        await db.execute(sql`
          INSERT INTO product_school (product_id, school_id)
          VALUES (${productId}, ${schoolId})
          ON CONFLICT DO NOTHING
        `);
        schoolLinks++;
      } else {
        missingSchool++;
      }
    }

    if (item.orgGrade) {
      const g = canonicalGrade(item.orgGrade);
      if (g) {
        await db.execute(sql`
          INSERT INTO product_grades (product_id, grade)
          VALUES (${productId}, ${g})
          ON CONFLICT DO NOTHING
        `);
        gradeLinks++;
      }
    }
  }

  console.log(`Wrote ${schoolLinks} school links + ${gradeLinks} grade links`);
  console.log(`Unmatched (item not in products table): ${unmatchedProduct}`);
  console.log(`Item School-Code not in schools table: ${missingSchool}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
