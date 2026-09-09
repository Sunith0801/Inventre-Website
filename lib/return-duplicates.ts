/**
 * Shared, client-safe helpers for the "this exchange was rejected as a
 * duplicate" story. Kept free of any server-only imports (db, node
 * crypto) so it can be pulled into both the server-rendered detail page
 * and the client-side status banner.
 *
 * When audit rejects an exchange because the same item is already covered
 * by another request, the `exchange.rejected` webhook carries a
 * `duplicate_of` array naming those request(s). We persist it on
 * `returns.duplicate_of` and surface it to the customer so they see WHICH
 * RTN already exists and WHO raised it, instead of a vague "duplicate".
 */

/** Who opened the request that this one duplicates. */
export type RaisedBy = "team" | "customer";

/** One entry in `returns.duplicate_of`, mirroring the webhook payload. */
export interface DuplicateOfEntry {
  return_number: string;
  status?: string | null;
  raised_by?: RaisedBy | null;
}

// Matches both numbering schemes: audit-minted manual codes (RTN-M-123)
// and inventre's yearly sequence (RTN-2026-01337). Kept in sync with the
// server-side minting in lib/exchange.ts / the audit bridge.
const RTN_RE = /\bRTN-(?:M-\d+|\d{4}-\d+)\b/g;

/**
 * Coerce whatever is stored in `returns.duplicate_of` (jsonb → unknown)
 * into a clean, typed list. Drops anything without a usable
 * `return_number`. Returns [] for null / non-array / empty.
 */
export function parseDuplicateOf(raw: unknown): DuplicateOfEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: DuplicateOfEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rn = (item as Record<string, unknown>).return_number;
    if (typeof rn !== "string" || !rn.trim()) continue;
    const rb = (item as Record<string, unknown>).raised_by;
    const st = (item as Record<string, unknown>).status;
    out.push({
      return_number: rn.trim(),
      raised_by: rb === "team" || rb === "customer" ? rb : null,
      status: typeof st === "string" ? st : null,
    });
  }
  return out;
}

/**
 * Fallback for older rejections that predate the `duplicate_of` column:
 * pull any RTN codes out of the free-text rejection reason. `raised_by`
 * is unknown in this path, so it comes back null (the UI then omits the
 * "raised by …" qualifier). Excludes `selfNumber` so a reason that echoes
 * the rejected request's own code doesn't point it at itself.
 */
export function extractDuplicateRtns(
  reason: string | null | undefined,
  selfNumber?: string | null
): DuplicateOfEntry[] {
  if (!reason) return [];
  const seen = new Set<string>();
  const out: DuplicateOfEntry[] = [];
  for (const m of reason.matchAll(RTN_RE)) {
    const rn = m[0];
    if (selfNumber && rn === selfNumber) continue;
    if (seen.has(rn)) continue;
    seen.add(rn);
    out.push({ return_number: rn, raised_by: null, status: null });
  }
  return out;
}

/**
 * The single source of truth the UI should render: prefer the structured
 * `duplicate_of`; fall back to RTNs scraped from the reason text.
 */
export function resolveDuplicateOf(
  duplicateOf: unknown,
  reason: string | null | undefined,
  selfNumber?: string | null
): DuplicateOfEntry[] {
  const structured = parseDuplicateOf(duplicateOf);
  if (structured.length > 0) return structured;
  return extractDuplicateRtns(reason, selfNumber);
}
