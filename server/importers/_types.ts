/**
 * Shared types for ERP CSV/Excel importers.
 *
 * Each importer:
 *  - declares a doctype name + filename hints (auto-detection)
 *  - declares required headers (validation)
 *  - implements processOne(row) → result
 *
 * Importers reuse the same idempotent upsert logic as the migration scripts.
 */

export type ImportRow = Record<string, unknown>;

export type ImportResult = "new" | "updated" | "skipped" | "error";

export type ImportSummary = {
  doctype: string;
  total: number;
  new: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails: { row: number; reason: string }[];
};

export interface DocTypeImporter {
  /** Display name (e.g. "Customer", "Item Price") */
  doctype: string;

  /** Filename substrings that suggest this importer (case-insensitive). */
  filenameHints: string[];

  /** At least one of these headers must be present. Used for auto-detection. */
  signatureHeaders: string[];

  /** Process one row → {result, error?} */
  processOne(row: ImportRow): Promise<{ result: ImportResult; error?: string }>;
}

/** Trim and lowercase a header for fuzzy matching. */
export function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/** Get a value by trying multiple header variants (case/whitespace-insensitive). */
export function pickField(
  row: ImportRow,
  ...candidates: string[]
): string | null {
  for (const cand of candidates) {
    const target = normalizeHeader(cand);
    for (const [k, v] of Object.entries(row)) {
      if (normalizeHeader(k) === target) {
        if (v == null || v === "") return null;
        return String(v).trim();
      }
    }
  }
  return null;
}

export function pickNumber(row: ImportRow, ...candidates: string[]): number | null {
  const v = pickField(row, ...candidates);
  if (v == null) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function pickInt(row: ImportRow, ...candidates: string[]): number | null {
  const n = pickNumber(row, ...candidates);
  return n == null ? null : Math.round(n);
}
