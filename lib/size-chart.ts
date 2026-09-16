/**
 * A size chart is rows of `{ size, ...measurements }` where the measurement
 * columns are whatever the admin defined for that product — chest / length
 * / sleeve for a shirt, waist / inseam for trousers, UK / EU / cm for shoes.
 * Column order is the key order of the rows (JSON keeps insertion order),
 * so the first row is the source of truth for ordering.
 *
 * Rows written before columns were dynamic have exactly chest / length /
 * sleeve — they need no migration.
 */
export type SizeChartRow = { size: string } & Record<string, string>;

export const DEFAULT_SIZE_COLUMNS = ["chest", "length", "sleeve"] as const;

/** Measurement columns of a chart, first-seen order, `size` excluded. */
export function sizeChartColumns(rows: SizeChartRow[] | null | undefined): string[] {
  const cols: string[] = [];
  for (const r of rows ?? []) {
    for (const k of Object.keys(r)) if (k !== "size" && !cols.includes(k)) cols.push(k);
  }
  return cols;
}

/** "chest" → "Chest", "uk_size" → "Uk size". Admin-typed labels stay as typed. */
export function sizeChartColumnLabel(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
