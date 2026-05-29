/* eslint-disable no-console */
/**
 * Migrate ERPNext Items (parents only — has_variants=1) into `products`.
 *
 *   npx tsx scripts/migrate-from-erp/04-items.ts [--sample=N] [--school=KLINK]
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
  CUTOVER_SQL,
  DRY_RUN,
  dryRunBanner,
  newDryRunReport,
  recordDryRunDiff,
  diffRows,
  writeDryRunReport,
} from "./_db";
import { products, categories, schools } from "../../db/schema";
import { eq, lt } from "drizzle-orm";
import { buildQrPayload, renderQrSvg } from "../../lib/qr";

const SCRIPT = "04-items";

type Item = {
  name: string;
  item_name: string;
  item_group: string;
  gst_hsn_code?: string;
  stock_uom?: string;
  disabled?: number;
  is_sales_item?: number;
  has_variants?: number;
  variant_of?: string | null;
  image?: string;
  custom_size_chart?: string;
  custom_school_name?: string;
  custom_display_price?: number;
  custom_inventre_cost_price?: number;
  custom_organization_mrp?: number;
  custom_customer_discount?: number;
  custom_weight?: number;
  custom_length?: number;
  custom_widthwaist?: number;
  custom_height?: number;
  custom_minimum_order_quantity?: number;
  custom_reordering_tat?: number;
  custom_gst_inclusiveexclusive?: string;
  description?: string;
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const TREATMENT_FOR_HSN: Record<string, "taxable" | "nil_rated" | "exempt" | "non_gst" | "zero_rated"> = {
  "61012000": "nil_rated",
  "61022000": "nil_rated",
};

async function main() {
  const args = process.argv.slice(2);
  const sample = Number(args.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 0);
  const schoolFilter = args.find((a) => a.startsWith("--school="))?.split("=")[1];

  await ensureCheckpointTable();
  dryRunBanner(SCRIPT);
  console.log(`\n[${SCRIPT}] migrating parent Items${sample ? ` (sample ${sample})` : ""}${schoolFilter ? ` filter=${schoolFilter}` : ""}\n`);

  const filters: unknown[] = [["has_variants", "=", 1]];
  if (schoolFilter) filters.push(["custom_school_name", "like", `%${schoolFilter}%`]);

  let processed = 0, upserts = 0, skipped = 0;
  const report = newDryRunReport(SCRIPT, "Item");

  for await (const page of erpListPages<Item>("Item", {
    fields: ["name", "item_name", "item_group", "custom_school_name", "disabled"],
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
        const it = await erpGetDoc<Item>("Item", stub.name);

        // Resolve category by item_group name
        const cat = await db
          .select()
          .from(categories)
          .where(eq(categories.slug, slugify(it.item_group)))
          .limit(1);
        if (cat.length === 0) {
          await logMigrationError(SCRIPT, "Item", it.name, `category not found: ${it.item_group}`);
          skipped++;
          continue;
        }

        const slug = slugify(it.name);
        const hsn = it.gst_hsn_code ?? null;
        const gstTreatment: "taxable" | "nil_rated" | "exempt" | "non_gst" | "zero_rated" =
          (hsn && TREATMENT_FOR_HSN[hsn]) ? TREATMENT_FOR_HSN[hsn] : "taxable";
        // Empty string defaults to Inclusive (Indian retail convention)
        const gstFlag = (it.custom_gst_inclusiveexclusive || "Inclusive").toLowerCase();
        const gstInclusive = gstFlag !== "exclusive";

        const dimensions =
          it.custom_length || it.custom_widthwaist || it.custom_height
            ? { l: it.custom_length ?? 0, w: it.custom_widthwaist ?? 0, h: it.custom_height ?? 0 }
            : null;

        // Compute basePrice from display_price; fallback 0
        const displayPrice = (it.custom_display_price ?? 0) * 100;

        const payload = {
          slug,
          name: it.item_name,
          tagline: null,
          description: it.description ? [it.description] : null,
          categoryId: cat[0].id,
          basePrice: displayPrice || 0,
          baseMrp: it.custom_organization_mrp ? it.custom_organization_mrp * 100 : null,
          status: "active" as const,
          itemCode: it.name,
          hsnCode: hsn,
          gstTreatment,
          gstInclusive,
          weightGrams: it.custom_weight ? Math.round(it.custom_weight * 1000) : null,
          dimensions,
          minOrderQty: it.custom_minimum_order_quantity || 1,
          reorderTatDays: it.custom_reordering_tat ?? null,
          costPrice: it.custom_inventre_cost_price ? it.custom_inventre_cost_price * 100 : null,
          displayPrice: displayPrice || null,
          customerDiscountPercent: it.custom_customer_discount?.toString() ?? null,
          organizationMrp: it.custom_organization_mrp ? it.custom_organization_mrp * 100 : null,
          sizeChartUrl: it.custom_size_chart ?? null,
        };

        // QR code
        const qrPayload = buildQrPayload({
          itemCode: it.name,
          itemName: it.item_name,
          weightGrams: payload.weightGrams,
          dimensions: dimensions ?? null,
        });

        // Look up the existing product so we can decide between insert,
        // pre-cutover update, and post-cutover skip — and surface the diff
        // in dry-run reports.
        const existing = await db
          .select()
          .from(products)
          .where(eq(products.itemCode, it.name))
          .limit(1);

        if (existing[0] && existing[0].createdAt && existing[0].createdAt >= CUTOVER_DATE) {
          // Post-cutover product (created by the live website) — leave untouched.
          report.counts.would_skip_post_cutover++;
          processed++;
          continue;
        }

        const changed = existing[0]
          ? diffRows(existing[0] as unknown as Record<string, unknown>, payload as unknown as Record<string, unknown>)
          : Object.keys(payload);
        const isInsert = !existing[0];

        if (DRY_RUN) {
          if (isInsert) report.counts.would_insert++;
          else if (changed.length === 0) report.counts.would_skip_unchanged++;
          else report.counts.would_update++;
          recordDryRunDiff(report, {
            key: it.name,
            before: existing[0] ? (existing[0] as unknown as Record<string, unknown>) : null,
            after: payload as unknown as Record<string, unknown>,
            changedFields: changed,
          });
        } else {
          await db
            .insert(products)
            .values({ ...payload, qrCodeData: qrPayload, qrCodeSvg: renderQrSvg(qrPayload) })
            .onConflictDoUpdate({
              target: products.itemCode,
              set: payload,
              // Defensive guard at the DB layer too: if a row was created at
              // or after the cutover (live website), the SET clause is a no-op.
              setWhere: lt(products.createdAt, CUTOVER_SQL),
            });

          // Link to school via product_school.
          //
          // ERP stores custom_school_name as "<CODE>-<Name>" e.g.
          // "KLINK-Kidlink School". The original lookup did an exact
          // `eq(schools.name, raw)` which never matched (local
          // schools.name is just "Kidlink School"), so ~886 products
          // ended up with no school link and were invisible in the
          // school+grade catalog view. Fix: split on the first dash,
          // match the prefix against schools.school_code, and fall
          // back to whole-string or post-dash name matches for the
          // few items that don't follow the CODE-Name pattern.
          if (it.custom_school_name) {
            const raw = it.custom_school_name.trim();
            const dashIdx = raw.indexOf("-");
            const codeGuess = dashIdx > 0 ? raw.slice(0, dashIdx).trim() : null;
            const postDashName = dashIdx > 0 ? raw.slice(dashIdx + 1).trim() : null;

            let sch = codeGuess
              ? await db.select().from(schools).where(eq(schools.schoolCode, codeGuess)).limit(1)
              : [];
            if (sch.length === 0) {
              sch = await db.select().from(schools).where(eq(schools.name, raw)).limit(1);
            }
            if (sch.length === 0 && postDashName) {
              sch = await db.select().from(schools).where(eq(schools.name, postDashName)).limit(1);
            }
            if (sch.length > 0) {
              const prodRow = await db
                .select()
                .from(products)
                .where(eq(products.itemCode, it.name))
                .limit(1);
              if (prodRow[0]) {
                await db.execute(
                  /* sql */ `INSERT INTO product_school (product_id, school_id, is_required) VALUES ('${prodRow[0].id}', '${sch[0].id}', false) ON CONFLICT DO NOTHING` as never
                );
              }
            } else {
              await logMigrationError(
                SCRIPT,
                "Item",
                it.name,
                `unresolved custom_school_name="${raw}" (tried code="${codeGuess}", name="${raw}", post-dash="${postDashName}")`
              );
            }
          }
        }

        upserts++;
        processed++;
        if (processed % 25 === 0) {
          console.log(`  progress: ${processed} items (${upserts} upserts, ${skipped} skipped)`);
          await writeCheckpoint(SCRIPT, processed, it.name);
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
  console.log(`\n[${SCRIPT}] ${DRY_RUN ? "DRY-RUN" : "✓"} done — ${processed} processed, ${upserts} upserts, ${skipped} skipped\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
