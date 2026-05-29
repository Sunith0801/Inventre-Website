/* eslint-disable no-console */
/**
 * BOM-import created stub products from raw CSV cells. Some BOM rows had
 * doubled school prefixes ("WMWM WF Caps" instead of "WM WF Caps") that
 * we faithfully reproduced. This script normalises those names and, when
 * a canonical variant doesn't already exist, simply renames.
 *
 * Strategy:
 *   1) Pattern-match double-prefix typos: ^([A-Z]{2,5})\\1\\b (e.g. WMWM, SASSAS)
 *      OR specific known typos hardcoded below.
 *   2) Compute canonical name (collapse double prefix).
 *   3) If canonical product exists → merge links + delete the typo'd row.
 *   4) Otherwise → just rename.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

const KNOWN_TYPOS: Array<{ pattern: RegExp; collapse: (name: string) => string }> = [
  // ^XYZXYZ … → ^XYZ … (collapse repeated all-caps prefix)
  {
    pattern: /^([A-Z]{2,6})\1\b\s/,
    collapse: (name) => name.replace(/^([A-Z]{2,6})\1\b\s/, "$1 "),
  },
];

function canonicalNameFor(name: string): string | null {
  for (const t of KNOWN_TYPOS) {
    if (t.pattern.test(name)) {
      const candidate = t.collapse(name).replace(/\s+/g, " ").trim();
      if (candidate !== name && candidate.length > 0) return candidate;
    }
  }
  return null;
}

async function main() {
  const all = (await db.execute(sql`
    SELECT id, name FROM products WHERE name IS NOT NULL
  `)) as unknown as { id: string; name: string }[];

  const fixes: { id: string; oldName: string; newName: string }[] = [];
  for (const p of all) {
    const c = canonicalNameFor(p.name);
    if (c) fixes.push({ id: p.id, oldName: p.name, newName: c });
  }
  console.log(`Detected ${fixes.length} typo'd product names`);

  let renamed = 0;
  let merged = 0;

  for (const f of fixes) {
    const existing = (await db.execute(sql`
      SELECT id FROM products WHERE name = ${f.newName} LIMIT 1
    `)) as unknown as { id: string }[];
    const canonicalId = existing[0]?.id;

    if (!canonicalId) {
      // Simple rename
      await db.execute(sql`
        UPDATE products SET name = ${f.newName}, erp_name = ${f.newName}
         WHERE id = ${f.id}
      `);
      renamed++;
      console.log(`  rename: "${f.oldName}" → "${f.newName}"`);
    } else {
      // Merge: move links from f.id → canonicalId, delete f.id
      await db.execute(sql`
        INSERT INTO product_school (product_id, school_id)
          SELECT ${canonicalId}, school_id FROM product_school WHERE product_id = ${f.id}
          ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO product_grades (product_id, grade)
          SELECT ${canonicalId}, grade FROM product_grades WHERE product_id = ${f.id}
          ON CONFLICT DO NOTHING
      `);
      // Re-point any bundle_components that reference the typo'd id
      await db.execute(sql`
        UPDATE bundle_components SET product_id = ${canonicalId}
         WHERE product_id = ${f.id}
      `);
      await db.execute(sql`DELETE FROM products WHERE id = ${f.id}`);
      merged++;
      console.log(`  merge:  "${f.oldName}" → "${f.newName}"`);
    }
  }

  console.log(`Done. renamed=${renamed}, merged=${merged}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
