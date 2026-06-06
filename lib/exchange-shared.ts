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
