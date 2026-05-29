/* eslint-disable no-console */
/**
 * Migrate ERPNext Sales Invoices into `invoices` + `invoiceItems`.
 *
 *   npx tsx scripts/migrate-from-erp/11-invoices.ts [--sample=N]
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
  writeDryRunReport,
} from "./_db";
import { invoices, invoiceItems, orders, parents, productVariants } from "../../db/schema";
import { eq } from "drizzle-orm";

const SCRIPT = "11-invoices";

type SI = {
  name: string;
  customer: string;
  posting_date: string;
  due_date?: string;
  net_total: number;
  total_taxes_and_charges: number;
  grand_total: number;
  rounded_total?: number;
  outstanding_amount: number;
  status: string;
  is_return?: number;
  is_debit_note?: number;
  gst_category?: string;
  place_of_supply?: string;
  einvoice_status?: string;
  ewaybill_status?: string;
  items?: SIItem[];
};

type SIItem = {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  gst_hsn_code?: string;
  gst_treatment?: string;
  cgst_rate?: number;
  sgst_rate?: number;
  igst_rate?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  sales_order?: string;
};

const STATUS_MAP: Record<string, "draft" | "submitted" | "paid" | "overdue" | "cancelled"> = {
  Draft: "draft",
  Submitted: "submitted",
  Paid: "paid",
  Overdue: "overdue",
  Cancelled: "cancelled",
  Return: "submitted",
  Unpaid: "submitted",
  "Partly Paid": "submitted",
  "Credit Note Issued": "submitted",
};

function fyOf(d: string): string {
  const dt = new Date(d);
  const m = dt.getMonth() + 1;
  const y = dt.getFullYear();
  return m >= 4
    ? `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`
    : `${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;
}

async function main() {
  const sample = Number(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 0);
  await ensureCheckpointTable();
  dryRunBanner(SCRIPT);
  console.log(`\n[${SCRIPT}] migrating Sales Invoices${sample ? ` (sample ${sample})` : ""}\n`);

  let processed = 0, inserted = 0, skipped = 0;
  const report = newDryRunReport(SCRIPT, "Sales Invoice");

  for await (const page of erpListPages<{ name: string }>("Sales Invoice", {
    fields: ["name"],
    filters: [["docstatus", "in", [1, 2]]],
    pageSize: 50,
    sample: sample || undefined,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "posting_date",
  })) {
    for (const stub of page) {
      try {
        const si = await erpGetDoc<SI>("Sales Invoice", stub.name);

        // Defensive anomaly log: an invoice with posting_date >= cutover
        // means someone posted to the retired ERPNext after we cut over.
        if (si.posting_date && new Date(si.posting_date) >= CUTOVER_DATE) {
          report.counts.would_skip_post_cutover++;
          await logMigrationError(
            SCRIPT,
            "Sales Invoice",
            si.name,
            `post-cutover ERP posting_date=${si.posting_date} — review`
          );
          skipped++;
          continue;
        }

        // Find linked order (via items[0].sales_order)
        const linkedOrderName = si.items?.find((i) => i.sales_order)?.sales_order;
        let orderId: string | null = null;
        if (linkedOrderName) {
          const o = await db.select().from(orders).where(eq(orders.orderNumber, linkedOrderName)).limit(1);
          orderId = o[0]?.id ?? null;
        }
        if (!orderId) {
          report.counts.unresolved_dependency++;
          await logMigrationError(SCRIPT, "Sales Invoice", si.name, "linked order not found");
          skipped++;
          continue;
        }

        // Resolve parent via the order
        const o = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        const parentId = o[0]?.parentId;
        if (!parentId) {
          report.counts.unresolved_dependency++;
          skipped++;
          continue;
        }

        // Skip if already imported. invoiceNumber == ERP `name` (insert-only).
        const existing = await db
          .select()
          .from(invoices)
          .where(eq(invoices.invoiceNumber, si.name))
          .limit(1);
        if (existing[0]) {
          if (existing[0].createdAt && existing[0].createdAt >= CUTOVER_DATE) {
            report.counts.would_skip_post_cutover++;
          } else {
            report.counts.would_skip_unchanged++;
          }
          processed++;
          continue;
        }

        const netP = Math.round(si.net_total * 100);
        const taxP = Math.round((si.total_taxes_and_charges ?? 0) * 100);
        const grandP = Math.round(si.grand_total * 100);
        const outstandingP = Math.round((si.outstanding_amount ?? 0) * 100);

        let cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
        for (const it of si.items ?? []) {
          cgstTotal += Math.round((it.cgst_amount ?? 0) * 100);
          sgstTotal += Math.round((it.sgst_amount ?? 0) * 100);
          igstTotal += Math.round((it.igst_amount ?? 0) * 100);
        }

        const invoiceInsertPayload = {
          invoiceNumber: si.name,
          financialYear: fyOf(si.posting_date),
          orderId,
          parentId,
          postingDate: si.posting_date,
          dueDate: si.due_date ?? si.posting_date,
          netTotal: netP,
          cgstTotal,
          sgstTotal,
          igstTotal,
          taxTotal: taxP,
          roundingAdjustment: 0,
          grandTotal: grandP,
          outstandingAmount: outstandingP,
          status: STATUS_MAP[si.status] ?? "submitted",
          isReturn: !!si.is_return,
          isDebitNote: !!si.is_debit_note,
          billingAddress: o[0]?.shippingAddress ?? {},
          shippingAddress: o[0]?.shippingAddress ?? {},
          placeOfSupply: si.place_of_supply ?? null,
          gstCategory: si.gst_category ?? "Unregistered",
          createdAt: new Date(si.posting_date),
        } as const;

        if (DRY_RUN) {
          report.counts.would_insert++;
          recordDryRunDiff(report, {
            key: si.name,
            before: null,
            after: invoiceInsertPayload as unknown as Record<string, unknown>,
            changedFields: Object.keys(invoiceInsertPayload),
          });
          inserted++;
          processed++;
          continue;
        }

        const [created] = await db
          .insert(invoices)
          .values(invoiceInsertPayload)
          .returning();

        if (si.items?.length) {
          const lines = await Promise.all(
            si.items.map(async (it) => {
              const v = await db
                .select()
                .from(productVariants)
                .where(eq(productVariants.sku, it.item_code))
                .limit(1);
              const cg = Math.round((it.cgst_amount ?? 0) * 100);
              const sg = Math.round((it.sgst_amount ?? 0) * 100);
              const ig = Math.round((it.igst_amount ?? 0) * 100);
              const net = Math.round(it.amount * 100);
              return {
                invoiceId: created.id,
                variantId: v[0]?.id ?? null,
                hsnCode: it.gst_hsn_code ?? null,
                itemNameSnapshot: it.item_name,
                qty: it.qty,
                unitPrice: Math.round(it.rate * 100),
                netAmount: net,
                taxableAmount: net,
                cgstRate: (it.cgst_rate ?? 0).toString(),
                sgstRate: (it.sgst_rate ?? 0).toString(),
                igstRate: (it.igst_rate ?? 0).toString(),
                cgstAmount: cg,
                sgstAmount: sg,
                igstAmount: ig,
                totalAmount: net + cg + sg + ig,
                gstTreatment: (it.gst_treatment === "Nil-Rated"
                  ? "nil_rated"
                  : "taxable") as "nil_rated" | "taxable",
              };
            })
          );
          const validLines = lines.filter((l): l is typeof l & { variantId: string } =>
            l.variantId !== null
          );
          if (validLines.length) {
            await db.insert(invoiceItems).values(validLines);
          }
        }

        inserted++;
        processed++;
        if (processed % 50 === 0) {
          console.log(`  progress: ${processed} invoices (${inserted} new, ${skipped} skipped)`);
          await writeCheckpoint(SCRIPT, processed, si.name);
        }
      } catch (e) {
        report.counts.errored++;
        await logMigrationError(SCRIPT, "Sales Invoice", stub.name, e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (!DRY_RUN) await writeCheckpoint(SCRIPT, processed, null, true);
  if (DRY_RUN) {
    const out = await writeDryRunReport(report);
    console.log(`\n[${SCRIPT}] dry-run ✓ counts=${JSON.stringify(report.counts)} → ${out}\n`);
  }
  console.log(`\n[${SCRIPT}] ${DRY_RUN ? "DRY-RUN" : "✓"} done — ${processed} processed, ${inserted} new, ${skipped} skipped\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
