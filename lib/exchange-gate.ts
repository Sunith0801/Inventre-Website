import "server-only";

/**
 * Phone allowlist gate for the in-flight customer-raised exchange flow.
 *
 * Tester phones live in EXCHANGE_TESTER_PHONES (comma-separated last-10
 * digit phones, e.g. "7013232148,9876543210"). Unset → feature OFF for
 * everyone. We compare on last-10-digit form so "+91…", "91…", "0…"
 * prefixes that may sneak into `parents.phone` over its history all
 * resolve to the same canonical key.
 *
 * Re-reading the env on every call is fine here — it's a String.split
 * on a tiny value, and lets ops flip a tester in/out by editing
 * `.env.deploy` + restarting without touching the DB.
 */

function last10(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "").slice(-10);
}

function getAllowlist(): Set<string> {
  const raw = process.env.EXCHANGE_TESTER_PHONES ?? "";
  return new Set(
    raw
      .split(",")
      .map((p) => last10(p.trim()))
      .filter((p) => p.length === 10)
  );
}

export function isExchangeTester(phone: string | null | undefined): boolean {
  // Phase 2 (2026-06-14): full rollout. EXCHANGE_OPEN_TO_ALL=true opens the
  // flow to every authenticated parent in production. Reversible from env
  // alone (flip to false → falls back to the EXCHANGE_TESTER_PHONES
  // allowlist). Ownership scope stays strict — see isExchangeScopeRelaxed,
  // which is NOT affected by this flag, so a user can still only act on
  // their own orders.
  if (process.env.EXCHANGE_OPEN_TO_ALL === "true") return true;
  // Dev: gate is fully open so every parent can exercise exchange /
  // missing on any delivered order. The phone allowlist is a
  // production-only safety belt during early rollout.
  if (process.env.NODE_ENV !== "production") return true;
  const norm = last10(phone);
  if (norm.length !== 10) return false;
  return getAllowlist().has(norm);
}

/**
 * Dev-only ownership relaxation for the exchange / missing flows.
 *
 * The dev DB is a prod snapshot, so almost every delivered order's
 * local `orders.parent_id` belongs to some real parent — not to the
 * tester who logged in on :3020. The strict parentId scope would hide
 * the Exchange / Report-missing buttons on every order a tester can
 * see. Outside production we drop the parentId match (order id /
 * order_number still has to resolve) so every delivered order shows
 * both buttons. In production this is always false — scope stays strict.
 */
export function isExchangeScopeRelaxed(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Number of testers currently configured; used by admin telemetry. */
export function exchangeTesterCount(): number {
  return getAllowlist().size;
}
