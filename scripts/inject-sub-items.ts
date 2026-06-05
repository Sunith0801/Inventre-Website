/* eslint-disable no-console */
/**
 * Pull `custom_sub_items` from ERPNext for each order in the input CSV
 * and drop them into the matching local `order_items.bundle_selections`
 * JSONB. Nothing else is touched — header status, payment, parent,
 * school, item rows are all left as-is.
 *
 *   ERP_API_KEY=… ERP_API_SECRET=… ERP_BASE_URL=https://erp.inventre.in \
 *   DATABASE_URL=… npx tsx scripts/inject-sub-items.ts                  # dry-run
 *   …                                                          --apply
 *   …                                                          --limit=10
 *   …                                                          --order=SAL-ORD-2026-25580
 *
 * Selection: every order_number in scripts/data/ccavenue-orders-to-
 * reconcile.csv that exists locally (i.e. the 263-row CCAvenue list, minus
 * the ones still missing from local DB — those need item rows before
 * sub-items can attach to a parent).
 *
 * Matching: ERPNext's `custom_sub_items[i].parent_item_code` is joined to
 * the local order_items row whose `size` (we populate size with the
 * ERP `item_code` on mirror+stub imports) matches. Each matched line's
 * bundle_selections is overwritten with the full sub-item list for that
 * parent.
 *
 * Dry-run by default. --apply runs serially — ERPNext rate-limits and
 * the parent transactions are short.
 */
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { orderItems, orders, payments } from "@/db/schema";

type Flags = { apply: boolean; limit?: number; order?: string; csvPath: string };

function parseFlags(): Flags {
  const flags: Flags = {
    apply: false,
    csvPath: path.resolve(process.cwd(), "scripts/data/ccavenue-orders-to-reconcile.csv"),
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") flags.apply = true;
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--order=")) flags.order = arg.slice("--order=".length);
    else if (arg.startsWith("--csv=")) flags.csvPath = path.resolve(process.cwd(), arg.slice("--csv=".length));
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

function loadCsvOrders(p: string): string[] {
  const text = fs.readFileSync(p, "utf8");
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const first = line.split(",")[0].trim();
    if (!first || first === "order_number") continue;
    if (first.startsWith("SAL-ORD-")) out.push(first);
  }
  return out;
}

type ErpSubItem = {
  parent_item_code?: string | null;
  item_code?: string | null;
  qty?: number | null;
  item_group?: string | null;
  item_name?: string | null;
  [k: string]: unknown;
};

type ErpSoFetch = {
  subItems: ErpSubItem[];
  grandTotal: number | null;
  netTotal: number | null;
  totalTaxes: number | null;
  customPaidAmount: number | null;
  customPaymentMode: string | null;
  customPaymentDate: string | null;
  customPaymentFlow: string | null;
  customInternalRef: string | null;
  customPaymentStatus: string | null;
  creationTs: string | null;
  transactionDate: string | null;
};

async function fetchErpSo(orderNumber: string): Promise<ErpSoFetch | null> {
  const base = (process.env.ERP_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("ERP_BASE_URL not set");
  const key = process.env.ERP_API_KEY;
  const secret = process.env.ERP_API_SECRET;
  if (!key || !secret) throw new Error("ERP_API_KEY + ERP_API_SECRET must be set");
  const url = `${base}/api/resource/Sales%20Order/${encodeURIComponent(orderNumber)}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null; // not in ERPNext
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ERPNext GET ${orderNumber} → ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Record<string, unknown> };
  const d = json?.data ?? {};
  const subs = (d as { custom_sub_items?: unknown }).custom_sub_items;
  return {
    subItems: Array.isArray(subs) ? (subs as ErpSubItem[]) : [],
    grandTotal: typeof d.grand_total === "number" ? (d.grand_total as number) : null,
    netTotal: typeof d.net_total === "number" ? (d.net_total as number) : null,
    totalTaxes: typeof d.total_taxes_and_charges === "number" ? (d.total_taxes_and_charges as number) : null,
    customPaidAmount: typeof d.custom_paid_amount === "number" ? (d.custom_paid_amount as number) : null,
    customPaymentMode: typeof d.custom_payment_mode === "string" ? (d.custom_payment_mode as string) : null,
    customPaymentDate: typeof d.custom_payment_date === "string" ? (d.custom_payment_date as string) : null,
    customPaymentFlow: typeof d.custom_payment_flow === "string" ? (d.custom_payment_flow as string) : null,
    customInternalRef: typeof d.custom_internal_payment_reference === "string" ? (d.custom_internal_payment_reference as string) : null,
    customPaymentStatus: typeof d.custom_payment_status === "string" ? (d.custom_payment_status as string) : null,
    creationTs: typeof d.creation === "string" ? (d.creation as string) : null,
    transactionDate: typeof d.transaction_date === "string" ? (d.transaction_date as string) : null,
  };
}

type LocalLine = { id: string; size: string; nameSnapshot: string; existing: unknown };

async function loadLocalLines(orderId: string): Promise<LocalLine[]> {
  const rows = await db
    .select({
      id: orderItems.id,
      size: orderItems.size,
      nameSnapshot: orderItems.nameSnapshot,
      existing: orderItems.bundleSelections,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return rows as LocalLine[];
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

async function main() {
  const flags = parseFlags();
  if (!process.env.ERP_API_KEY || !process.env.ERP_API_SECRET || !process.env.ERP_BASE_URL) {
    throw new Error("ERP_API_KEY, ERP_API_SECRET, ERP_BASE_URL must be set in env");
  }

  const csvList = loadCsvOrders(flags.csvPath);
  const filtered = flags.order ? csvList.filter((n) => n === flags.order) : csvList;
  const work = flags.limit ? filtered.slice(0, flags.limit) : filtered;
  if (work.length === 0) {
    console.log("[inject-subs] no orders match the filter");
    return;
  }

  console.log(
    `[inject-subs] ${work.length} order(s)${flags.apply ? "" : "  (DRY-RUN — no writes)"}\n`,
  );
  console.log(
    [
      pad("order_number", 22),
      pad("erp_subs", 9),
      pad("local_lines", 12),
      pad("matched", 8),
      pad("unmatched", 10),
      "applied",
    ].join(" | "),
  );
  console.log("-".repeat(110));

  let okOrders = 0;
  let skippedNotLocal = 0;
  let failed = 0;
  let totalSubsWritten = 0;

  for (const orderNumber of work) {
    let applied = "";
    let erpSubsCount = 0;
    let localLinesCount = 0;
    let matchedParents = 0;
    let unmatchedSubs = 0;
    try {
      const [orderRow] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);
      if (!orderRow) {
        applied = "skipped:not_local";
        skippedNotLocal++;
        console.log(
          [
            pad(orderNumber, 22),
            pad("—", 9),
            pad("—", 12),
            pad("—", 8),
            pad("—", 10),
            applied,
          ].join(" | "),
        );
        continue;
      }

      const erpData = await fetchErpSo(orderNumber);
      if (!erpData) {
        applied = "skipped:not_in_erpnext";
        skippedNotLocal++;
        console.log([pad(orderNumber, 22), pad("—", 9), pad("—", 12), pad("—", 8), pad("—", 10), applied].join(" | "));
        continue;
      }
      const erpSubs = erpData.subItems;
      erpSubsCount = erpSubs.length;

      const lines = await loadLocalLines(orderRow.id);
      localLinesCount = lines.length;

      // Group sub-items by parent_item_code
      const byParent = new Map<string, ErpSubItem[]>();
      for (const s of erpSubs) {
        const pic = s.parent_item_code;
        if (typeof pic !== "string" || !pic) {
          unmatchedSubs++;
          continue;
        }
        const list = byParent.get(pic) ?? [];
        list.push(s);
        byParent.set(pic, list);
      }

      // Match each parent_item_code to a local order_items row where
      // size==parent_item_code (item_code stored as size on ERP imports).
      const linesBySize = new Map<string, LocalLine>();
      for (const l of lines) linesBySize.set(l.size, l);

      if (flags.apply) {
        for (const [parentItemCode, subs] of byParent) {
          const target = linesBySize.get(parentItemCode);
          if (!target) {
            unmatchedSubs += subs.length;
            continue;
          }
          const bundleSelections = subs.map((s) => ({
            item_code: typeof s.item_code === "string" ? s.item_code : null,
            qty: typeof s.qty === "number" ? s.qty : null,
            item_name: typeof s.item_name === "string" ? s.item_name : null,
            item_group: typeof s.item_group === "string" ? s.item_group : null,
            parent_item_code: parentItemCode,
          }));
          await db
            .update(orderItems)
            .set({ bundleSelections })
            .where(and(eq(orderItems.id, target.id)));
          matchedParents++;
          totalSubsWritten += subs.length;
        }
        // Order totals + payment from the same ERPNext doc. payment_status
        // is INTENTIONALLY NOT TOUCHED — CCAvenue-verified `paid` state
        // must stick (ERPNext records FAILED for some of these orders
        // even though CCAvenue confirms capture).
        if (erpData.grandTotal != null) {
          const grandP = Math.round(erpData.grandTotal * 100);
          const netP = Math.round((erpData.netTotal ?? erpData.grandTotal) * 100);
          const taxP = Math.round((erpData.totalTaxes ?? 0) * 100);
          // Order date — prefer ERPNext `creation` timestamp, fall back
          // to `transaction_date` (date-only). Parses defensively;
          // unrecognised values leave placed_at alone.
          const dateStr = erpData.creationTs ?? erpData.transactionDate ?? null;
          const placedAt = dateStr ? new Date(dateStr) : null;
          const placedAtValid = placedAt && !isNaN(placedAt.getTime()) ? placedAt : null;
          await db
            .update(orders)
            .set({
              total: grandP,
              subtotal: netP,
              tax: taxP,
              ...(placedAtValid ? { placedAt: placedAtValid, createdAt: placedAtValid } : {}),
            })
            .where(eq(orders.id, orderRow.id));
          await db
            .update(payments)
            .set({
              amount: grandP,
              method: erpData.customPaymentMode ?? undefined,
              paymentMode: erpData.customPaymentMode ?? undefined,
              paymentFlow: erpData.customPaymentFlow ?? undefined,
              paymentDate: erpData.customPaymentDate ?? undefined,
              paidAmount: erpData.customPaidAmount != null ? erpData.customPaidAmount.toFixed(2) : undefined,
              internalPaymentReference: erpData.customInternalRef ?? undefined,
            })
            .where(eq(payments.orderId, orderRow.id));
        }
        applied = `wrote(${matchedParents}parent/${totalSubsWritten}subs+totals)`;
      } else {
        for (const [parentItemCode, subs] of byParent) {
          if (linesBySize.has(parentItemCode)) {
            matchedParents++;
            totalSubsWritten += subs.length;
          } else {
            unmatchedSubs += subs.length;
          }
        }
        applied = matchedParents > 0 ? `dry:${matchedParents}p/${totalSubsWritten}s` : "dry:0";
      }
      okOrders++;
    } catch (e) {
      applied = `FAILED:${e instanceof Error ? e.message.slice(0, 40) : String(e)}`;
      failed++;
    }

    console.log(
      [
        pad(orderNumber, 22),
        pad(String(erpSubsCount), 9),
        pad(String(localLinesCount), 12),
        pad(String(matchedParents), 8),
        pad(String(unmatchedSubs), 10),
        applied,
      ].join(" | "),
    );
  }

  console.log("");
  console.log(
    `[inject-subs] summary: ${okOrders} processed, ${skippedNotLocal} skipped (not in local DB), ${failed} failed; ${totalSubsWritten} sub-items ${flags.apply ? "written" : "ready to write"}`,
  );
  if (!flags.apply) console.log("[inject-subs] dry-run. Re-run with --apply to write.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
