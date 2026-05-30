/* eslint-disable no-console */
/**
 * Adopt the two existing SMS Grade 10 "2nd Lan" Bookkit products into a
 * new template parent so the storefront's language picker can surface them.
 *
 * Background: the storefront catalog query at lib/repos/products.ts:648
 * strips any kit/set whose name contains "2nd Lan" — they're meant to
 * appear as language picks on a parent kit's PDP, not as standalone
 * catalog cards. SMS Grade 10 has no parent kit, so the two language
 * children are invisible to parents at that school.
 *
 * What this script does:
 *   1. Resolves the St. Michaels School row + the two existing language
 *      products by slug.
 *   2. Creates a template parent "SMS Grade 10 Bookkit" (kind=kit,
 *      is_variant_item=false, variant_of_product_id=null, status=active),
 *      tagged for (St. Michaels School, Grade 10), category Books Bundle.
 *   3. Updates each of the two existing products:
 *        - variant_of_product_id = <template.id>
 *        - is_variant_item       = true
 *      Their existing product_bundles + bundle_components are preserved,
 *      which is the whole point of the adopt-rather-than-rebuild path.
 *   4. Verifies each adopted product still has bundle_components (the
 *      storefront's loadKitLanguageVariants EXISTS check would filter
 *      them out otherwise).
 *
 * Idempotent: re-running detects an existing template by slug and skips
 * the insert step, only re-applying the variant_of_product_id update.
 *
 * Run with:
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *     npx tsx scripts/adopt-sms-grade-10-bookkit.ts
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  products,
  schools,
  productSchool,
  productGrades,
  productBundles,
  bundleComponents,
  categories,
} from "../db/schema";
import * as schema from "../db/schema";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const TEMPLATE_NAME = "SMS Grade 10 Bookkit";
const TEMPLATE_SLUG = "sms-grade-10-bookkit";
const CHILD_SLUGS = [
  "sms-grade-10-hindi-2nd-lan-telugu-3rd-lan",
  "sms-grade-10-telugu-2nd-lan",
];
const SCHOOL_NAME_LIKE = "%michael%";
const GRADE = "Grade 10";

async function main() {
  console.log(`\nAdopting SMS Grade 10 "2nd Lan" products into "${TEMPLATE_NAME}"\n`);

  // 1. Resolve school
  const [school] = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .where(sql`${schools.name} ILIKE ${SCHOOL_NAME_LIKE}`)
    .limit(1);
  if (!school) throw new Error(`No school matching ${SCHOOL_NAME_LIKE}`);
  console.log(`  school: ${school.name} (${school.id})`);

  // 2. Resolve the two existing children
  const children = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      variantOf: products.variantOfProductId,
      isVariantItem: products.isVariantItem,
    })
    .from(products)
    .where(inArray(products.slug, CHILD_SLUGS));
  if (children.length !== CHILD_SLUGS.length) {
    const found = new Set(children.map((c) => c.slug));
    const missing = CHILD_SLUGS.filter((s) => !found.has(s));
    throw new Error(`Missing existing products by slug: ${missing.join(", ")}`);
  }
  for (const c of children) {
    console.log(`  child: ${c.name} (${c.id})`);
  }

  // Sanity: each child must already have product_bundles + bundle_components
  // — that's what the storefront picker requires (EXISTS check at
  //   lib/repos/products.ts:403).
  for (const c of children) {
    const rows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM product_bundles pb
       JOIN bundle_components bc ON bc.bundle_id = pb.id
       WHERE pb.product_id = ${c.id}
    `)) as unknown as { n: number }[];
    const n = rows[0]?.n ?? 0;
    if (n === 0) {
      throw new Error(
        `Aborting — "${c.name}" has zero bundle_components; storefront would filter it out.`,
      );
    }
    console.log(`    BOM rows on ${c.slug}: ${n}`);
  }

  // 3. Find or create the template
  const [existingTemplate] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, TEMPLATE_SLUG))
    .limit(1);

  let templateId: string;
  if (existingTemplate) {
    templateId = existingTemplate.id;
    console.log(`  template: reusing existing ${TEMPLATE_NAME} (${templateId})`);
  } else {
    // Best-effort category lookup — "Books Bundle"-ish.
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(sql`lower(${categories.name}) LIKE '%book%bundle%'`)
      .limit(1);

    const [inserted] = await db
      .insert(products)
      .values({
        name: TEMPLATE_NAME,
        slug: TEMPLATE_SLUG,
        basePrice: 0,
        baseMrp: null,
        categoryId: cat?.id ?? null,
        status: "active",
        kind: "kit",
        isMagicBox: false,
        isVariantItem: false,
        variantOfProductId: null,
      })
      .returning({ id: products.id });
    templateId = inserted.id;
    console.log(`  template: created ${TEMPLATE_NAME} (${templateId})`);

    await db
      .insert(productSchool)
      .values({ productId: templateId, schoolId: school.id })
      .onConflictDoNothing();
    await db
      .insert(productGrades)
      .values({ productId: templateId, grade: GRADE })
      .onConflictDoNothing();
    console.log(`    tagged (school, grade) → ${school.name} × ${GRADE}`);
  }

  // 4. Adopt: set variant_of_product_id + is_variant_item on each child
  for (const c of children) {
    if (c.variantOf === templateId && c.isVariantItem) {
      console.log(`    ${c.slug}: already adopted, skipping`);
      continue;
    }
    await db
      .update(products)
      .set({ variantOfProductId: templateId, isVariantItem: true })
      .where(eq(products.id, c.id));
    console.log(`    ${c.slug}: variantOfProductId=${templateId}, isVariantItem=true`);
  }

  // 5. Smoke test — does loadKitLanguageVariants-style query now return both?
  const adopted = (await db.execute(sql`
    SELECT p.id, p.name FROM products p
     WHERE p.variant_of_product_id = ${templateId}
       AND p.status = 'active'
       AND p.kind = 'kit'
       AND EXISTS (
         SELECT 1 FROM product_school ps
          WHERE ps.product_id = ${templateId} AND ps.school_id = ${school.id}
       )
       AND EXISTS (
         SELECT 1 FROM product_bundles pb
          JOIN bundle_components bc ON bc.bundle_id = pb.id
          WHERE pb.product_id = p.id
       )
     ORDER BY p.name
  `)) as unknown as { id: string; name: string }[];
  console.log(`\n  storefront would see ${adopted.length} language variant(s):`);
  for (const r of adopted) console.log(`    - ${r.name}`);

  console.log("\nDone.\n");
}

main()
  .then(() => client.end())
  .catch((e) => {
    console.error(e);
    return client.end().then(() => process.exit(1));
  });
