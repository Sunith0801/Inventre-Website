/* eslint-disable no-console */
/**
 * Migrate ERPNext variant Items into productVariants + productVariantAttributes.
 *
 *   npx tsx scripts/migrate-from-erp/05-variants.ts [--sample=N] [--school=KLINK]
 */

import { erpListPages, erpGetDoc } from "./_client";
import {
  db,
  shutdown,
  ensureCheckpointTable,
  writeCheckpoint,
  logMigrationError,
  CUTOVER_DATE,
  CUTOVER_ISO,
  DRY_RUN,
  dryRunBanner,
  newDryRunReport,
  recordDryRunDiff,
  diffRows,
  writeDryRunReport,
} from "./_db";
import {
  productVariants,
  products,
  productAttributes,
  productAttributeValues,
  productAttributeBindings,
  productVariantAttributes,
} from "../../db/schema";
import { eq, and } from "drizzle-orm";

const SCRIPT = "05-variants";

type VariantItem = {
  name: string;
  item_name: string;
  variant_of: string;
  disabled?: number;
  custom_school_name?: string;
  custom_weight?: number;
  image?: string;
  attributes?: { attribute: string; attribute_value: string }[];
};

async function main() {
  const args = process.argv.slice(2);
  const sample = Number(args.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 0);
  const schoolFilter = args.find((a) => a.startsWith("--school="))?.split("=")[1];

  await ensureCheckpointTable();
  dryRunBanner(SCRIPT);
  console.log(`\n[${SCRIPT}] migrating variant Items${sample ? ` (sample ${sample})` : ""}\n`);

  const filters: unknown[] = [["variant_of", "is", "set"]];
  if (schoolFilter) filters.push(["custom_school_name", "like", `%${schoolFilter}%`]);

  let processed = 0, upserts = 0, skipped = 0;
  const report = newDryRunReport(SCRIPT, "Item Variant");

  for await (const page of erpListPages<VariantItem>("Item", {
    fields: ["name", "item_name", "variant_of", "disabled"],
    filters,
    pageSize: 50,
    sample: sample || undefined,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "modified",
  })) {
    for (const stub of page) {
      try {
        if (stub.disabled) {
          skipped++;
          continue;
        }
        const v = await erpGetDoc<VariantItem>("Item", stub.name);

        // Resolve parent product
        const parentRow = await db
          .select()
          .from(products)
          .where(eq(products.itemCode, v.variant_of))
          .limit(1);
        if (!parentRow[0]) {
          report.counts.unresolved_dependency++;
          await logMigrationError(SCRIPT, "Item", v.name, `parent ${v.variant_of} not found`);
          skipped++;
          continue;
        }

        // productVariants has no created_at; use the parent product's
        // createdAt as the cutover signal. If the parent product was created
        // by the live website (>= cutover), every variant under it is
        // assumed live-website-owned too — skip.
        const parentIsPostCutover =
          !!parentRow[0].createdAt && parentRow[0].createdAt >= CUTOVER_DATE;
        if (parentIsPostCutover) {
          report.counts.would_skip_post_cutover++;
          processed++;
          continue;
        }

        // Pick a "size" string for legacy column — first size-typed attribute or first value
        const sizeAttr = v.attributes?.find((a) => /size/i.test(a.attribute));
        const sizeVal = sizeAttr?.attribute_value ?? v.attributes?.[0]?.attribute_value ?? "—";

        // Upsert variant
        const existing = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.sku, v.name))
          .limit(1);
        let variantId: string;

        const variantPayload = {
          productId: parentRow[0].id,
          size: sizeVal,
          weightGrams: v.custom_weight ? Math.round(v.custom_weight * 1000) : null,
          imageUrl: v.image ?? null,
          isActive: true,
        };

        if (DRY_RUN) {
          if (existing[0]) {
            const changed = diffRows(
              existing[0] as unknown as Record<string, unknown>,
              variantPayload as unknown as Record<string, unknown>
            );
            if (changed.length === 0) report.counts.would_skip_unchanged++;
            else report.counts.would_update++;
            recordDryRunDiff(report, {
              key: v.name,
              before: existing[0] as unknown as Record<string, unknown>,
              after: variantPayload as unknown as Record<string, unknown>,
              changedFields: changed,
            });
          } else {
            report.counts.would_insert++;
            recordDryRunDiff(report, {
              key: v.name,
              before: null,
              after: variantPayload as unknown as Record<string, unknown>,
              changedFields: Object.keys(variantPayload),
            });
          }
          processed++;
          // In dry-run we skip attribute / refresh side-effects entirely; the
          // counts above are sufficient for the safety report.
          continue;
        }

        if (existing[0]) {
          await db
            .update(productVariants)
            .set(variantPayload)
            .where(eq(productVariants.id, existing[0].id));
          variantId = existing[0].id;
        } else {
          const [created] = await db
            .insert(productVariants)
            .values({
              ...variantPayload,
              sku: v.name,
              stockQty: 0,
              lowStockThreshold: 5,
            })
            .returning();
          variantId = created.id;
          upserts++;
        }

        // Wire up attributes
        for (const attr of v.attributes ?? []) {
          const aRow = await db
            .select()
            .from(productAttributes)
            .where(eq(productAttributes.name, attr.attribute))
            .limit(1);
          if (!aRow[0]) continue;

          // ensure value exists
          const vRow = await db
            .select()
            .from(productAttributeValues)
            .where(
              and(
                eq(productAttributeValues.attributeId, aRow[0].id),
                eq(productAttributeValues.value, attr.attribute_value)
              )
            )
            .limit(1);
          let valueId: string;
          if (vRow[0]) {
            valueId = vRow[0].id;
          } else {
            const [createdV] = await db
              .insert(productAttributeValues)
              .values({ attributeId: aRow[0].id, value: attr.attribute_value })
              .returning();
            valueId = createdV.id;
          }

          // ensure product binding exists
          await db
            .insert(productAttributeBindings)
            .values({ productId: parentRow[0].id, attributeId: aRow[0].id, isRequired: true })
            .onConflictDoNothing();

          // upsert variant attribute mapping
          await db
            .insert(productVariantAttributes)
            .values({ variantId, attributeId: aRow[0].id, valueId })
            .onConflictDoUpdate({
              target: [productVariantAttributes.variantId, productVariantAttributes.attributeId],
              set: { valueId },
            });
        }

        // Re-derive products.attribute_groups for the parent template so
        // the PDP picker has fresh axis/value data. Called per-variant
        // (idempotent) — cheap, and avoids needing a second pass after
        // the variant loop completes.
        const { refreshProductAttributeGroups } = await import(
          "../../lib/repos/product-attribute-groups"
        );
        await refreshProductAttributeGroups(parentRow[0].id);

        processed++;
        if (processed % 50 === 0) {
          console.log(`  progress: ${processed} variants (${upserts} new, ${skipped} skipped)`);
          await writeCheckpoint(SCRIPT, processed, v.name);
        }
      } catch (e) {
        report.counts.errored++;
        await logMigrationError(SCRIPT, "Item", stub.name, e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (!DRY_RUN) await writeCheckpoint(SCRIPT, processed, null, true);
  if (DRY_RUN) {
    const out = await writeDryRunReport(report);
    console.log(`\n[${SCRIPT}] dry-run ✓ counts=${JSON.stringify(report.counts)} → ${out}\n`);
  }
  console.log(`\n[${SCRIPT}] ${DRY_RUN ? "DRY-RUN" : "✓"} done — ${processed} processed, ${upserts} new, ${skipped} skipped\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
