import "server-only";
import * as XLSX from "xlsx";
import type { DocTypeImporter, ImportSummary } from "@/server/importers/_types";
import { normalizeHeader } from "@/server/importers/_types";
import { customerImporter } from "@/server/importers/customer";
import { itemImporter } from "@/server/importers/item";
import { itemPriceImporter } from "@/server/importers/item-price";
import { binImporter } from "@/server/importers/bin";
import { addressImporter } from "@/server/importers/address";
import { salesInvoiceImporter } from "@/server/importers/sales-invoice";
import { categoryImporter } from "@/server/importers/category";
import { attributeImporter } from "@/server/importers/attribute";
import { salesOrderImporter } from "@/server/importers/sales-order";

export const IMPORTERS: DocTypeImporter[] = [
  customerImporter,
  itemImporter,
  itemPriceImporter,
  binImporter,
  addressImporter,
  salesInvoiceImporter,
  categoryImporter,
  attributeImporter,
  salesOrderImporter,
];

/** Detect the right importer for a file from its name + headers. */
export function detectImporter(args: {
  filename: string;
  headers: string[];
}): DocTypeImporter | null {
  const lc = args.filename.toLowerCase();
  const normHeaders = args.headers.map(normalizeHeader);

  // 1. Filename hint match
  for (const imp of IMPORTERS) {
    if (imp.filenameHints.some((h) => lc.includes(h.toLowerCase()))) {
      // Verify at least one signature header is present
      const hasSig = imp.signatureHeaders.some((sig) => normHeaders.includes(normalizeHeader(sig)));
      if (hasSig) return imp;
    }
  }

  // 2. Header signature match (filename was ambiguous)
  for (const imp of IMPORTERS) {
    const sigs = imp.signatureHeaders.map(normalizeHeader);
    const matches = sigs.filter((s) => normHeaders.includes(s)).length;
    if (matches >= 2) return imp;
  }

  return null;
}

/** Parse a CSV/Excel buffer into rows. */
export function parseSpreadsheet(buf: Buffer, filename: string): {
  rows: Record<string, unknown>[];
  headers: string[];
} {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, headers };
}

export type ImportApplyOptions = {
  dryRun: boolean;
  /** Stop after N successful rows (for testing). */
  limit?: number;
};

export async function applyImport(
  importer: DocTypeImporter,
  rows: Record<string, unknown>[],
  opts: ImportApplyOptions
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    doctype: importer.doctype,
    total: rows.length,
    new: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };
  if (opts.dryRun) {
    summary.skipped = rows.length;
    return summary;
  }
  const cap = Math.min(rows.length, opts.limit ?? rows.length);
  for (let i = 0; i < cap; i++) {
    try {
      const out = await importer.processOne(rows[i]);
      if (out.result === "new") summary.new++;
      else if (out.result === "updated") summary.updated++;
      else if (out.result === "skipped") {
        summary.skipped++;
        if (out.error && summary.errorDetails.length < 50) {
          summary.errorDetails.push({ row: i + 2, reason: out.error });
        }
      } else {
        summary.errors++;
        if (out.error && summary.errorDetails.length < 50) {
          summary.errorDetails.push({ row: i + 2, reason: out.error });
        }
      }
    } catch (e) {
      summary.errors++;
      if (summary.errorDetails.length < 50) {
        summary.errorDetails.push({ row: i + 2, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return summary;
}
