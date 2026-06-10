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
  // Dev: gate is fully open so every parent can exercise exchange /
  // missing on any delivered order. The phone allowlist is a
  // production-only safety belt during early rollout.
  if (process.env.NODE_ENV !== "production") return true;
  const norm = last10(phone);
  if (norm.length !== 10) return false;
  return getAllowlist().has(norm);
}

/** Number of testers currently configured; used by admin telemetry. */
export function exchangeTesterCount(): number {
  return getAllowlist().size;
}
