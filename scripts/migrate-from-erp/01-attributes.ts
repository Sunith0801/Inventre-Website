/* eslint-disable no-console */
/**
 * Migrate Item Attributes + their values from ERPNext.
 * Upsert by name → productAttributes; values upserted on (attributeId, value).
 *
 *   npx tsx scripts/migrate-from-erp/01-attributes.ts [--sample=N]
 */

import { erpListPages, erpGetDoc } from "./_client";
import { db, ensureCheckpointTable, writeCheckpoint, shutdown } from "./_db";
import { productAttributes, productAttributeValues } from "../../db/schema";
import { eq } from "drizzle-orm";

const SCRIPT = "01-attributes";

type Attr = {
  name: string;
  attribute_name?: string;
  disabled?: number;
  item_attribute_values?: { attribute_value: string; abbr?: string }[];
};

const TYPE_FOR = (n: string): "size" | "color" | "design" | "model" | "other" => {
  const x = n.toLowerCase();
  if (x.includes("size") || /\b(uk|s|m|l|xl)\b/.test(x)) return "size";
  if (x.includes("color") || x.includes("colour")) return "color";
  if (x.includes("design")) return "design";
  if (x.includes("model") || x.includes("bottle")) return "model";
  return "other";
};

async function main() {
  const sample = Number((process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1]) ?? 0);
  await ensureCheckpointTable();
  console.log(`\n[${SCRIPT}] migrating Item Attributes${sample ? ` (sample ${sample})` : ""}\n`);

  let processed = 0, upserts = 0, valueUpserts = 0;

  for await (const page of erpListPages<Attr>("Item Attribute", {
    fields: ["name", "disabled"],
    pageSize: 50,
    sample: sample || undefined,
  })) {
    for (const a of page) {
      try {
        const full = await erpGetDoc<Attr>("Item Attribute", a.name);
        const type = TYPE_FOR(full.name);

        const existing = await db
          .select()
          .from(productAttributes)
          .where(eq(productAttributes.name, full.name))
          .limit(1);
        let attrId: string;
        if (existing.length) {
          attrId = existing[0].id;
        } else {
          const [created] = await db
            .insert(productAttributes)
            .values({ name: full.name, type })
            .returning();
          attrId = created.id;
          upserts++;
        }

        for (const v of full.item_attribute_values ?? []) {
          await db
            .insert(productAttributeValues)
            .values({
              attributeId: attrId,
              value: v.attribute_value,
              shortCode: v.abbr ?? null,
            })
            .onConflictDoNothing();
          valueUpserts++;
        }

        processed++;
        if (processed % 10 === 0) {
          console.log(`  progress: ${processed} attributes (${upserts} new, ${valueUpserts} values)`);
          await writeCheckpoint(SCRIPT, processed, full.name);
        }
      } catch (e) {
        console.error(`  ✗ ${a.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  await writeCheckpoint(SCRIPT, processed, null, true);
  console.log(`\n[${SCRIPT}] ✓ done — ${processed} processed, ${upserts} new attributes, ${valueUpserts} values\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
