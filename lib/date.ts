/**
 * Pure date helpers for the customer-raised exchange flow.
 *
 * No tz library by design: the runtime container is fixed to IST
 * (Asia/Kolkata) via the TZ env, so JS Date arithmetic on the host
 * already lands in the parent's local day. The pickup date is stored
 * as a PostgreSQL `date` (no tz), so we serialise the IST calendar day
 * the helper returns.
 */

export const SATURDAY = 6; // JS Date.getDay(): 0 = Sun, 6 = Sat

/**
 * Returns the first Saturday strictly after `from + minBufferDays`.
 *
 * Worked examples (minBufferDays = 7):
 *   from = Mon → +7 = next Mon → first Sat after = +12 days
 *   from = Thu → +7 = next Thu → first Sat after =  +9 days  ← user's example
 *   from = Fri → +7 = next Fri → first Sat after =  +8 days
 *   from = Sat → +7 = next Sat → first Sat *after* = +14 days
 *   from = Sun → +7 = next Sun → first Sat after = +13 days
 *
 * "Strictly after" at the Saturday boundary: a parent requesting on a
 * Saturday should not be told to come the next Saturday (only 7 days
 * out — that's exactly the buffer, not safely past it). Push to the
 * one after.
 */
export function firstSaturdayAfter(from: Date, minBufferDays: number): Date {
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + minBufferDays);
  const dow = base.getDay();
  const step = dow === SATURDAY ? 7 : (SATURDAY - dow + 7) % 7;
  base.setDate(base.getDate() + step);
  return base;
}

/**
 * Pickup-date rule for the parent-raised exchange flow: first Saturday
 * at least one full week after the request was placed.
 */
export function firstPickupSaturday(requestDate: Date = new Date()): Date {
  return firstSaturdayAfter(requestDate, 7);
}

/**
 * `YYYY-MM-DD` formatter for a PostgreSQL `date` column. Uses the host
 * Date's local components (IST in prod) — do not pass through
 * toISOString() since that flips to UTC and can drop a day for
 * late-evening requests.
 */
export function toDbDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
