import "server-only";
import { erpFetch, isErpConfigured } from "@/server/erp/client";
import { IMPORTERS } from "@/server/importers";
import type { ImportSummary } from "@/server/importers/_types";

/**
 * Pull doctypes from a live Frappe / ERPNext server and feed each row through
 * the existing CSV importers. The user only has to drop:
 *   ERP_BASE_URL=https://erp.inventre.in
 *   ERP_API_KEY=<frappe user api_key>
 *   ERP_API_SECRET=<frappe user api_secret>
 *
 * Frappe REST: GET /api/resource/<doctype>?fields=["*"]&limit_page_length=0&filters=[...]
 */

type FrappeListResponse = { data: Record<string, unknown>[] };

const PAGE_SIZE = 500;

async function pullDoctype(
  doctype: string,
  filters: unknown[] = []
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let start = 0;
  // Frappe paginates with limit_start + limit_page_length
  // limit_page_length=0 returns ALL rows; safer to page.
  while (true) {
    const params = new URLSearchParams({
      fields: '["*"]',
      limit_start: String(start),
      limit_page_length: String(PAGE_SIZE),
    });
    if (filters.length) params.set("filters", JSON.stringify(filters));
    const path = `/api/resource/${encodeURIComponent(doctype)}?${params.toString()}`;
    const res = await erpFetch<FrappeListResponse>(path);
    const rows = res.data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  return out;
}

/**
 * Pull child-table rows by fetching each parent doctype with `?fields=["*"]`
 * — child tables come embedded under their fieldname.
 */
async function pullDoctypeFull(doctype: string): Promise<Record<string, unknown>[]> {
  // Some Frappe doctypes need the parent doctype + name to expand children.
  // For Sales Order, the list endpoint returns headers; we then GET each name.
  const list = await pullDoctype(doctype);
  const out: Record<string, unknown>[] = [];
  for (const r of list) {
    const name = r.name as string;
    if (!name) continue;
    const detail = await erpFetch<{ data: Record<string, unknown> }>(
      `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
    );
    out.push(detail.data);
  }
  return out;
}

/**
 * Map Frappe rows to importer rows. The importers use header-based access
 * (`pickField`) so we can pass the Frappe row objects through directly —
 * Frappe returns snake_case field names which match the importer's
 * normalize-header logic.
 */
async function runImporter(
  importerName: string,
  rows: Record<string, unknown>[]
): Promise<ImportSummary> {
  const imp = IMPORTERS.find((i) => i.doctype === importerName);
  if (!imp) {
    return {
      doctype: importerName,
      total: 0,
      new: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      errorDetails: [{ row: 0, reason: `importer '${importerName}' not found` }],
    };
  }
  const summary: ImportSummary = {
    doctype: importerName,
    total: rows.length,
    new: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = await imp.processOne(rows[i]);
      if (r.result === "error") {
        summary.errors++;
        summary.errorDetails.push({
          row: i + 1,
          reason: r.error ?? "unknown",
        });
      } else {
        summary[r.result]++;
      }
    } catch (e) {
      summary.errors++;
      summary.errorDetails.push({
        row: i + 1,
        reason: e instanceof Error ? e.message : "unknown",
      });
    }
  }
  return summary;
}

export type PullPlan = {
  doctype: string; // Frappe doctype name
  importer: string; // matching IMPORTERS entry
  filters?: unknown[];
};

/** Default sequence — order matters. Categories before items, items before prices, etc. */
export const DEFAULT_PULL_PLAN: PullPlan[] = [
  { doctype: "Item Group", importer: "Category" },
  { doctype: "Item Attribute", importer: "Attribute" },
  { doctype: "Item", importer: "Item" },
  { doctype: "Item Price", importer: "Item Price" },
  { doctype: "Bin", importer: "Bin" },
  { doctype: "Customer", importer: "Customer" },
  { doctype: "Address", importer: "Address" },
  {
    doctype: "Sales Order",
    importer: "Sales Order (open)",
    filters: [
      ["status", "in", ["Draft", "To Deliver", "To Bill", "To Deliver and Bill"]],
    ],
  },
  { doctype: "Sales Invoice", importer: "Sales Invoice" },
];

export async function pullAll(
  plan: PullPlan[] = DEFAULT_PULL_PLAN,
  onStep?: (step: { doctype: string; status: "fetching" | "importing" | "done"; summary?: ImportSummary }) => void
): Promise<ImportSummary[]> {
  if (!isErpConfigured()) {
    throw new Error(
      "ERP_BASE_URL / ERP_API_KEY / ERP_API_SECRET not configured"
    );
  }
  const results: ImportSummary[] = [];
  for (const step of plan) {
    onStep?.({ doctype: step.doctype, status: "fetching" });
    let rows: Record<string, unknown>[];
    if (step.doctype === "Sales Order" || step.doctype === "Sales Invoice") {
      rows = await pullDoctypeFull(step.doctype);
    } else {
      rows = await pullDoctype(step.doctype, step.filters);
    }
    onStep?.({ doctype: step.doctype, status: "importing" });
    const summary = await runImporter(step.importer, rows);
    results.push(summary);
    onStep?.({ doctype: step.doctype, status: "done", summary });
  }
  return results;
}
