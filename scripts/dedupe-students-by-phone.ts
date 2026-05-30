/* eslint-disable no-console */
/**
 * Phone-anchored dedupe — groups by (school_id, normalized_name,
 * parent_phone[last 10 digits]) and merges. Strongest signal we have
 * for "same kid" — same school, same name, same parent.
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";

const APPLY = process.argv.includes("--apply");

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const FK_TABLES = [
  "carts","cart_items","orders","product_drafts","reviews",
  "student_addresses","student_guardian_links","student_siblings",
  "website_cart_coupons","wishlists",
];

async function main() {
  console.log(`\nPhone-anchored dedupe ${APPLY ? "(APPLY)" : "(DRY-RUN)"}\n`);

  const raw = await db.execute(sql`
    WITH norm AS (
      SELECT s.id, s.school_id, s.school_code, s.first_name, s.erp_name,
             s.synced_at, s.created_at,
             right(regexp_replace(coalesce(p.phone, ''), '\\D', '', 'g'), 10) AS phone10,
             lower(regexp_replace(coalesce(s.first_name, s.name, ''), '[^a-z]', '', 'gi')) AS nk
        FROM students s LEFT JOIN parents p ON p.id = s.parent_id
       WHERE s.enabled = true
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY school_id, nk, phone10
        ORDER BY
          CASE WHEN erp_name LIKE 'MCB-%' THEN 1 WHEN erp_name LIKE 'ADMIN-%' THEN 2 ELSE 3 END,
          synced_at DESC NULLS LAST, created_at DESC NULLS LAST
      ) AS rn,
      COUNT(*) OVER (PARTITION BY school_id, nk, phone10) AS n
        FROM norm WHERE length(nk) >= 4 AND length(phone10) = 10
    )
    SELECT id::text AS row_id, school_id::text AS sid, school_code, first_name, nk, phone10, rn, n
      FROM ranked WHERE n > 1
     ORDER BY school_id, nk, phone10, rn
  `);
  const rows = (Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])) as {
    row_id: string; sid: string; school_code: string; first_name: string; nk: string; phone10: string;
    rn: number | string; n: number | string;
  }[];

  // Group: winner = rn=1, all rn>=2 are losers.
  const groups = new Map<string, { winner_id: string; loser_ids: string[]; name: string; school: string; phone: string }>();
  for (const r of rows) {
    const key = `${r.sid}::${r.nk}::${r.phone10}`;
    const rn = typeof r.rn === "string" ? parseInt(r.rn, 10) : r.rn;
    const cur = groups.get(key) ?? { winner_id: "", loser_ids: [], name: r.first_name, school: r.school_code, phone: r.phone10 };
    if (rn === 1) cur.winner_id = r.row_id;
    else cur.loser_ids.push(r.row_id);
    groups.set(key, cur);
  }
  const ready = [...groups.values()].filter((g) => g.winner_id && g.loser_ids.length > 0);
  const totalLosers = ready.reduce((s, g) => s + g.loser_ids.length, 0);

  console.log(`  ${ready.length} groups, ${totalLosers} loser rows to merge`);
  for (const g of ready) {
    console.log(`    ${g.school.padEnd(10)} ${g.name.padEnd(28)} phone=${g.phone}  -${g.loser_ids.length}`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — re-run with --apply.\n`);
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`CREATE TEMP TABLE _phone_pairs (winner_id uuid, loser_id uuid) ON COMMIT DROP`);
    for (const g of ready) {
      for (const lid of g.loser_ids) {
        await tx.execute(sql`INSERT INTO _phone_pairs VALUES (${g.winner_id}::uuid, ${lid}::uuid)`);
      }
    }

    // Field merge: copy losers' non-null values into winner where winner null.
    const MERGE_FIELDS = [
      "first_name","middle_name","last_name","name","grade","class","section",
      "gender","date_of_birth","blood_group","nationality","house_color","medium",
      "curriculum","shoe_size","shirt_size","trouser_size",
      "student_email_id","student_mobile_number","joining_date",
    ];
    for (const f of MERGE_FIELDS) {
      await tx.execute(sql.raw(`
        UPDATE students w
           SET ${f} = l.${f}
          FROM _phone_pairs p
          JOIN students l ON l.id = p.loser_id
         WHERE w.id = p.winner_id AND w.${f} IS NULL AND l.${f} IS NOT NULL
      `));
    }

    // Collision guards (guardian-link by phone, product_drafts PK, single cart/wishlist).
    await tx.execute(sql`
      DELETE FROM student_guardian_links l USING _phone_pairs p
       WHERE l.student_id = p.loser_id
         AND EXISTS (
           SELECT 1 FROM student_guardian_links w
            WHERE w.student_id = p.winner_id
              AND right(regexp_replace(coalesce(w.phone_no,''),'\\D','','g'),10)
                = right(regexp_replace(coalesce(l.phone_no,''),'\\D','','g'),10)
         )
    `);
    await tx.execute(sql`
      DELETE FROM product_drafts l USING _phone_pairs p
       WHERE l.student_id = p.loser_id
         AND EXISTS (
           SELECT 1 FROM product_drafts w
            WHERE w.student_id = p.winner_id
              AND w.parent_id = l.parent_id AND w.product_id = l.product_id
         )
    `);
    await tx.execute(sql`
      DELETE FROM cart_items WHERE cart_id IN (
        SELECT c.id FROM carts c JOIN _phone_pairs p ON c.student_id = p.loser_id
         WHERE EXISTS (SELECT 1 FROM carts c2 WHERE c2.student_id = p.winner_id)
      )
    `);
    await tx.execute(sql`DELETE FROM carts c USING _phone_pairs p WHERE c.student_id = p.loser_id AND EXISTS (SELECT 1 FROM carts c2 WHERE c2.student_id = p.winner_id)`);
    await tx.execute(sql`DELETE FROM wishlists w USING _phone_pairs p WHERE w.student_id = p.loser_id AND EXISTS (SELECT 1 FROM wishlists w2 WHERE w2.student_id = p.winner_id)`);

    for (const t of FK_TABLES) {
      await tx.execute(sql.raw(`
        UPDATE ${t} SET student_id = p.winner_id
          FROM _phone_pairs p WHERE ${t}.student_id = p.loser_id
      `));
    }
    await tx.execute(sql`DELETE FROM students WHERE id IN (SELECT loser_id FROM _phone_pairs)`);
  });

  console.log(`\nApplied. ${totalLosers} loser rows merged into ${ready.length} winners.\n`);
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
