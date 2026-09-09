/**
 * Shared quantity-cap helpers for the customer-facing exchange / missing
 * pickers. Client-safe (no `server-only`, no DB) so both forms import the
 * SAME clamp + wording — the server has its own authoritative cap in
 * `lib/return-qty-cap.ts`.
 *
 * Why a helper at all: an HTML `max=` on a number input is advisory. The
 * browser happily accepts typed and pasted values above it (that's exactly
 * how a customer raised an exchange for 2 × "SMS Caps" on an order that
 * contained 1), so every entry point has to clamp in JS — on change, on
 * blur, and once more when the payload is built.
 */

/**
 * Clamp a customer-entered quantity into 1..ceiling.
 *
 * Accepts anything an `<input type="number">` can hand back — including the
 * empty string (a cleared box), "abc" (some mobile keyboards), and floats.
 * A non-positive / unparseable value floors to 1 rather than 0, because a
 * request line for zero units is meaningless.
 */
export function clampRequestedQty(raw: unknown, ceiling: number): number {
  const max =
    Number.isFinite(ceiling) && ceiling > 0 ? Math.floor(ceiling) : 1;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(max, n);
}

/** True when the customer typed something ABOVE the ceiling (worth a toast). */
export function exceedsQtyCeiling(raw: unknown, ceiling: number): boolean {
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  const max =
    Number.isFinite(ceiling) && ceiling > 0 ? Math.floor(ceiling) : 1;
  return Math.floor(n) > max;
}

/**
 * Why the number jumped back. A silent clamp reads as a broken input, so
 * every clamp that changes what the customer typed gets one of these.
 *
 * `coveredByRef` is the earlier non-rejected request (RTN-… / MIS-…) that
 * already covers part of a multi-qty line — when the picker knows about
 * one, the ceiling is the REMAINDER and the wording says so.
 */
export function qtyCapMessage(
  itemName: string,
  ceiling: number,
  coveredByRef?: string | null,
): string {
  const n = Number.isFinite(ceiling) && ceiling > 0 ? Math.floor(ceiling) : 1;
  if (coveredByRef) {
    return `Only ${n} of "${itemName}" left — ${coveredByRef} covers the rest.`;
  }
  return `Only ${n} of "${itemName}" ${n === 1 ? "was" : "were"} ordered.`;
}
