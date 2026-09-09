/**
 * Customer-facing placement state for an order.
 *
 * An order ROW is created with status='placed' the moment checkout starts —
 * BEFORE payment. So an abandoned / never-paid checkout looks identical to a
 * real order in the `status` column, which confused parents (they saw
 * "Placed" + "pending" for an order they never actually paid for).
 *
 * This derives a clear state from payment + status + age:
 *   - 'not_placed' : unpaid and not progressed — an abandoned checkout or a
 *                    failed payment. No money was charged. The UI shows
 *                    "Not placed" + a reassurance banner + "order again".
 *   - 'processing' : freshly pending (< 1 h) — the payment may still be
 *                    settling (e.g. UPI "Awaited"); show "Processing".
 *   - 'normal'     : a real order — paid/refunded, or advanced past 'placed'.
 *
 * Display-only: no schema change. Mirrors the freshness window used by the
 * Magic Box limit guard so "abandoned" means the same thing everywhere.
 */
const FRESH_PENDING_MS = 60 * 60 * 1000; // 1 h — covers an active checkout / real settlement

export type Placement = "not_placed" | "processing" | "normal";

export function derivePlacement(o: {
  status: string;
  paymentStatus: string;
  createdAt: string;
}): Placement {
  const real =
    o.paymentStatus === "paid" ||
    o.paymentStatus === "refunded" ||
    o.status !== "placed";
  if (real) return "normal";
  const created = new Date(o.createdAt).getTime();
  const fresh =
    Number.isFinite(created) && Date.now() - created < FRESH_PENDING_MS;
  if (o.paymentStatus === "pending" && fresh) return "processing";
  return "not_placed";
}
