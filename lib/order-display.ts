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

/**
 * Plain-English meaning of a CCAvenue payment status, for the customer order
 * page. We show the ACTUAL gateway status word + a faithful, lightly-cleaned
 * version of the team's own definition — no relabelling into buckets.
 *
 * The raw value comes from `payments.gatewayResponseMessage`, which is messy:
 * it can be a bare word ("Aborted"), CCAvenue's long phrasing ("Transaction
 * aborted by system"), or a reconcile note ("…status=Initiated"). So we probe
 * by substring after pulling any `status=<word>` fragment, and return null
 * when we can't confidently identify the status (the UI then falls back to its
 * generic "Not completed" text).
 */
export type PaymentExplanation = { statusWord: string; description: string };

export function describePaymentStatus(
  raw: string | null | undefined,
): PaymentExplanation | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  // Prefer an explicit "status=<word>" fragment (reconcile messages); else
  // probe the whole string. Strip spaces/underscores/hyphens so "Auto
  // Cancelled" / "auto-cancelled" / "autocancelled" all collapse.
  const m = lower.match(/status=([a-z _-]+)/);
  const probe = (m ? m[1] : lower).replace(/[\s_-]+/g, "");
  const has = (sub: string) => probe.includes(sub);

  // Order matters: check the compound words before their substrings
  // (autoreversed/autocancelled before reversed/cancelled; successful before
  // cancelled cannot collide, but keep success early anyway).
  if (has("autorevers"))
    return {
      statusWord: "Auto-Reversed",
      description:
        "The bank didn’t confirm the transaction in time, so it was treated as failed and the amount is being reversed back to you.",
    };
  if (has("autocancel"))
    return {
      statusWord: "Auto-Cancelled",
      description:
        "The transaction wasn’t confirmed within 12 days and was auto-cancelled by the system.",
    };
  if (has("await"))
    return {
      statusWord: "Awaited",
      description:
        "The payment was submitted but the bank hasn’t responded yet. This usually updates within 24 hours, once reconciliation is complete.",
    };
  if (has("unsuccess"))
    return {
      statusWord: "Unsuccessful",
      description:
        "The transaction was declined by the bank. Please contact your bank to know the reason, then try again.",
    };
  if (has("initiat"))
    return {
      statusWord: "Initiated",
      description:
        "You reached the payment page but the payment was not completed. No amount was charged.",
    };
  if (has("abort"))
    return {
      statusWord: "Aborted",
      description:
        "You reached the payment page and selected a bank, but the transaction was dropped before it went through. No amount was charged.",
    };
  if (has("invalid"))
    return {
      statusWord: "Invalid",
      description: "The transaction couldn’t be processed due to invalid details.",
    };
  if (has("success") || has("shipped"))
    return {
      statusWord: "Successful",
      description: "Payment confirmed successfully.",
    };
  if (has("cancel"))
    return {
      statusWord: "Cancelled",
      description: "This transaction was cancelled.",
    };
  // Not in CCAvenue's official glossary but common in our own gateway logs.
  if (has("timeout") || has("timedout"))
    return {
      statusWord: "Timed out",
      description:
        "The payment session timed out before it was completed. No amount was charged.",
    };
  if (has("norecordfound"))
    return {
      statusWord: "Not completed",
      description:
        "The payment was not completed and the gateway has no record of a charge. No amount was charged.",
    };
  // Keep generic "failure" LAST so the specific words above win first.
  if (has("failure") || has("failed"))
    return {
      statusWord: "Payment failed",
      description:
        "The payment didn’t go through. No amount was charged — you can try again.",
    };
  return null;
}
