/**
 * Make the all-school merchandise products visible on every school's
 * storefront.
 *
 * INVENTRE BAGS, CRIMSON BAGS and WATER BOTTLES are the storefront's
 * all-school bag and bottle products — the ones the Ground Stock bridge feeds
 * from the audit's shared shelf by name — but they were linked to no school at
 * all, so no parent could see them. This links each of them to every active
 * school (anti-join insert: rerunnable, never duplicates a link) and files
 * WATER BOTTLES under `accessory`, which it is; it had been stored as a book.
 *
 * Run against prod by hand (the storefront's product caches refresh within
 * a minute):
 *   DATABASE_URL=<prod pgbouncer url> npx tsx scripts/enable-merch-for-all-schools.ts
 * Add --dry-run to see what would change.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const PRODUCTS = ["INVENTRE BAGS", "CRIMSON BAGS", "WATER BOTTLES"];

async function main() {
  const dry = process.argv.includes("--dry-run");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { max: 1 });
  try {
    const products = await sql<{ id: string; name: string; kind: string }[]>`
      select id, name, kind::text as kind from products
       where name = any(${PRODUCTS}) and status = 'active'`;
    const schools = await sql<{ id: string; name: string }[]>`
      select id, name from schools where status = 'active' order by name`;
    console.log(`${products.length} product(s), ${schools.length} active school(s), ${dry ? "DRY RUN" : "applying"}`);
    for (const p of products) {
      const missing = await sql<{ id: string; name: string }[]>`
        select s.id, s.name from schools s
         where s.status = 'active'
           and not exists (select 1 from product_school ps where ps.product_id = ${p.id} and ps.school_id = s.id)
         order by s.name`;
      console.log(`- ${p.name} (${p.kind}): ${missing.length} school link(s) to add`);
      if (!dry && missing.length) {
        await sql`
          insert into product_school (product_id, school_id, is_required)
          select ${p.id}, s.id, false from schools s
           where s.status = 'active'
             and not exists (select 1 from product_school ps where ps.product_id = ${p.id} and ps.school_id = s.id)`;
      }
      if (p.name === "WATER BOTTLES" && p.kind !== "accessory") {
        console.log(`  kind ${p.kind} → accessory`);
        if (!dry) await sql`update products set kind = 'accessory' where id = ${p.id}`;
      }
    }
    if (!dry) console.log("done — storefront caches refresh within 60 s");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
