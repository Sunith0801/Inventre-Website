/**
 * Client-safe slice of the exchange domain: types, status machine,
 * reason enums, and pure date formatting. No DB, no `server-only` —
 * import freely from both client components and server orchestrators.
 *
 * Server-side orchestrators (createExchange, transitionExchangeStatus,
 * etc.) live in lib/exchange.ts, which re-exports everything here for
 * back-compat — server code can keep importing from "@/lib/exchange"
 * and not notice the split.
 */

// ─── Reasons surfaced in the request form ──────────────────────────

export type ExchangeReason =
  | "wrong_size_delivered"
  | "damaged"
  | "wrong_item"
  | "defective"
  | "other";

export const EXCHANGE_REASONS: readonly { value: ExchangeReason; label: string }[] = [
  { value: "wrong_size_delivered", label: "Wrong size delivered" },
  { value: "damaged", label: "Item arrived damaged" },
  { value: "wrong_item", label: "Wrong item delivered" },
  { value: "defective", label: "Item is defective" },
  { value: "other", label: "Other (please describe)" },
] as const;

export function isExchangeReason(v: unknown): v is ExchangeReason {
  return (
    typeof v === "string" &&
    EXCHANGE_REASONS.some((r) => r.value === v)
  );
}

// ─── Sub-reasons (Phase 2) ─────────────────────────────────────────
//
// A second dropdown the customer picks under the top-level reason.
// Surfacing these gives customer-care a much tighter starting point
// when reviewing — they don't have to read free-text notes to know
// "wrong size" means "too small" vs "too large" vs "size chart
// mismatch". "other" intentionally has no sub-reasons; the free-text
// notes are mandatory there.

export const SUB_REASONS: Record<
  ExchangeReason,
  readonly { value: string; label: string }[]
> = {
  wrong_size_delivered: [
    { value: "too_small", label: "Too small" },
    { value: "too_large", label: "Too large" },
    { value: "size_chart_mismatch", label: "Size label doesn't match brand chart" },
  ],
  damaged: [
    { value: "packaging", label: "Packaging damaged in transit" },
    { value: "item", label: "Item damaged in transit" },
    { value: "both", label: "Both packaging and item damaged" },
  ],
  wrong_item: [
    { value: "wrong_color", label: "Wrong color" },
    { value: "wrong_design", label: "Wrong design / print" },
    { value: "wrong_product", label: "Completely different product" },
    { value: "wrong_language", label: "Wrong language (books)" },
  ],
  defective: [
    { value: "stitching", label: "Stitching issue" },
    { value: "tear", label: "Tear / hole" },
    { value: "button", label: "Button missing / broken" },
    { value: "print", label: "Print quality issue" },
    { value: "fabric", label: "Fabric issue" },
    { value: "pages", label: "Pages torn / missing (books)" },
    { value: "other", label: "Other defect" },
  ],
  other: [],
} as const;

export function isValidSubReason(top: ExchangeReason, sub: string): boolean {
  return SUB_REASONS[top].some((r) => r.value === sub);
}

// ─── Damage location (Phase 2) ─────────────────────────────────────
// Only relevant under `damaged` and `defective`.
export const DAMAGE_LOCATIONS: readonly { value: string; label: string }[] = [
  { value: "front", label: "Front of item" },
  { value: "back", label: "Back of item" },
  { value: "side", label: "Side / edge" },
  { value: "inside", label: "Inside / lining" },
  { value: "other", label: "Other (described in notes)" },
] as const;

// ─── Photo categories (Phase 2) ────────────────────────────────────
//
// Guided photo prompts shown to the customer when attaching evidence.
// Each photo carries one of these tags so customer-care knows what
// they're looking at without guessing. Phase 1 photos lack the tag —
// audit-side renders them in an "Other" bucket gracefully.

export const PHOTO_CATEGORIES: readonly { value: string; label: string; hint: string }[] = [
  {
    value: "front_full",
    label: "Front of item (full view)",
    hint: "Show the whole item so we can confirm what was delivered.",
  },
  {
    value: "issue_close_up",
    label: "Close-up of the issue",
    hint: "Zoom in on the size label / damage / defect.",
  },
  {
    value: "packaging",
    label: "Original packaging",
    hint: "Helpful for in-transit damage claims.",
  },
  {
    value: "size_label",
    label: "Size / variant label",
    hint: "The tag inside the item showing size + variant info.",
  },
  {
    value: "other",
    label: "Other supporting photo",
    hint: "Anything else that helps customer-care decide.",
  },
] as const;

export type ExchangePhoto = {
  url: string;
  key: string;
  // Phase-2 enrichment — optional so Phase-1 rows keep working.
  category?: string;
  caption?: string;
};

// ─── Duplicate-guard messages ──────────────────────────────────────
//
// Client-safe so both the server (409 bodies, form-page guards) and the
// client order page share ONE source of truth for the wording the
// customer sees.
//
// NOTE (2026-07-23): the post-delivery time window was fully removed —
// a delivered item is eligible for Exchange / Missing forever. Eligibility
// now depends only on delivery + the one-active-request-per-item lock.

/** Indefinite article for a request-kind label ("An Exchange" / "A Missing"). */
function articleFor(kind: "exchange" | "missing"): string {
  return kind === "exchange" ? "An Exchange" : "A Missing";
}

/**
 * Popup shown when a request already exists for this Sales Order
 * (Conditions 2 & 4). `existingKind` is the kind that already exists (the
 * lock is per SALE ORDER, so an open Exchange blocks a new Missing too and
 * the message names the existing one). `origin` is where that existing
 * request came from — a `care_team` request was raised by Customer Care in
 * the Audit portal and synced here, so we say so explicitly.
 */
export function alreadyRaisedMessage(
  existingKind: "exchange" | "missing",
  origin: "customer" | "care_team"
): string {
  const head = `${articleFor(existingKind)} request has already been raised for this Sales Order`;
  return origin === "care_team"
    ? `${head} by the Customer Care Team.`
    : `${head}.`;
}

// ─── Status machine ────────────────────────────────────────────────

export const EXCHANGE_STATUSES = [
  "requested",
  "approved",
  "rejected",
  "received",
] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

export function isExchangeStatus(v: unknown): v is ExchangeStatus {
  return typeof v === "string" && (EXCHANGE_STATUSES as readonly string[]).includes(v);
}

/**
 * "Approved or beyond" — a request that customer-care has accepted (or
 * already fulfilled) and which therefore PERMANENTLY blocks any further
 * exchange/missing on the same sale order. Covers both flows' vocab:
 * exchange (approved → received) and missing (approved →
 * received_at_school → delivered), plus audit's terminal aliases.
 * `requested` (still pending) and `rejected` (slot released) are NOT
 * approved. Client-safe so the blocked-request popup can use it too.
 */
const APPROVED_STATUSES: ReadonlySet<string> = new Set([
  "approved",
  "received",
  "received_at_school",
  "delivered",
  "completed",
  "exchange_completed",
]);

export function isApprovedStatus(status: string | null | undefined): boolean {
  return !!status && APPROVED_STATUSES.has(status);
}

const RANK: Record<ExchangeStatus, number> = {
  requested: 0,
  approved: 1,
  rejected: 1, // terminal sibling of approved
  received: 2,
};

const TERMINAL: ReadonlySet<ExchangeStatus> = new Set(["rejected", "received"]);

export function canTransition(from: ExchangeStatus, to: ExchangeStatus): boolean {
  if (from === to) return false;
  if (TERMINAL.has(from)) return false;
  return RANK[to] > RANK[from];
}

// ─── Friendly Saturday label for SMS + UI ──────────────────────────

/**
 * "Saturday, 21 June 2026". Accepts either a Date or the `YYYY-MM-DD`
 * form stored in the DB. Pure formatter — no Intl polyfills needed.
 */
export function formatPickupLabel(d: Date | string): string {
  const date = typeof d === "string" ? new Date(`${d}T00:00:00`) : d;
  const weekday = date.toLocaleDateString("en-IN", { weekday: "long" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-IN", { month: "long" });
  const year = date.getFullYear();
  return `${weekday}, ${day} ${month} ${year}`;
}

// ─── Customer self-cancellation ────────────────────────────────────
//
// A customer can cancel their own exchange / missing request while it is
// still early — before the warehouse has packed / dispatched the
// replacement. The ERP is the final authority on whether it's too late
// (see the cancel API routes + the ERP's 409 response); the storefront's
// status gate below is only the optimistic client-side hint.
//
// The cancellation reuses the EXISTING `rejected` terminal state rather
// than adding a new enum value: when the ERP confirms the cancel it fires
// the normal `exchange.rejected` / `missing.rejected` webhook with a
// `rejection_reason` that begins with `CANCELLED_REASON_PREFIX`. The
// storefront then labels that row "Cancelled" (not "Rejected"). Keeping
// this literal in one client-safe place means the server (which writes the
// prefix), the webhook (which reads it), and the status pages (which detect
// it) can never drift.

/** Human-readable "not yet dispatched" statuses at which a customer may
 *  still cancel. Shared by both flows (exchange + missing). `approved`
 *  means accepted-but-not-yet-at-school; once the replacement has arrived
 *  at school / been dispatched the request is no longer here. */
export const CANCELLABLE_REQUEST_STATUSES: ReadonlySet<string> = new Set([
  "requested",
  "approved",
]);

/** True when the request is at a stage the customer may still cancel from
 *  the storefront. `replacementArrived` promotes `approved` past the
 *  cancellable window (the replacement is already at school / dispatched). */
export function isCancellableRequestStatus(
  status: string | null | undefined,
  replacementArrived: boolean = false,
): boolean {
  if (replacementArrived) return false;
  return !!status && CANCELLABLE_REQUEST_STATUSES.has(status);
}

/** Prefix the ERP prepends to `rejection_reason` when a rejection is
 *  actually a customer/staff cancellation. Em dash per the ERP contract. */
export const CANCELLED_REASON_PREFIX = "Cancelled — ";

/** Does this rejection reason denote a cancellation (vs a genuine reject)?
 *  Tolerant of case and of an em-dash OR a plain hyphen so a slightly
 *  different ERP build still reads as "cancelled". */
export function isCancelledReason(reason: string | null | undefined): boolean {
  return !!reason && /^\s*cancelled\s*[—–-]/i.test(reason);
}

/** Strip the "Cancelled — " prefix so the customer's own reason can be
 *  shown plainly. Returns null when nothing meaningful remains. */
export function stripCancelledPrefix(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const out = reason.replace(/^\s*cancelled\s*[—–-]\s*/i, "").trim();
  return out.length > 0 ? out : null;
}

/** Normalize a raw customer reason into the ERP's canonical
 *  "Cancelled — <reason>" form (idempotent — won't double-prefix). Clamped
 *  to a safe length for the reason column. */
export function toCancelledReason(rawReason: string): string {
  const trimmed = rawReason.trim();
  const full = isCancelledReason(trimmed)
    ? trimmed
    : `${CANCELLED_REASON_PREFIX}${trimmed}`;
  return full.slice(0, 600);
}
