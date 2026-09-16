/**
 * Storefront availability — the one rule that decides whether a variant can
 * be bought, given the figure the Ground Stock bridge wrote into its bin.
 *
 * Pure: no database, no network. `server/repos/variant-resolver.ts` gathers
 * the facts (product kind, bin quantity, the admin gate setting) and calls
 * `availabilityFor`; every storefront surface reads the resolver, so this is
 * the only place the rule is written down.
 *
 * Why the kinds differ. The audit's Ground Stock page is a physical count
 * of garments, accessories and consumables per school, plus a book sheet.
 * Kits, sub-bundles and magic boxes are assembled to order from those
 * counted items and are never counted themselves — treating "not on the
 * sheet" as sold out would take every bookkit and box off the shelf. So:
 *
 *   uniform / accessory / consumable   counted stock. A matched item sells
 *                                      exactly what the audit says; an
 *                                      unmatched one follows the admin's
 *                                      `unmatched` choice (default: sold out,
 *                                      per the 2026-09-16 requirement that
 *                                      "no stock available" reads out of stock).
 *   book                               counted when it appears on the book
 *                                      sheet; otherwise assumed available —
 *                                      the sheet is partial by design.
 *   kit / sub_bundle / magic_box       never gated by this rule.
 *
 * With the gate switched off every variant reads as freely available, which
 * is exactly the storefront's behaviour before the bridge existed.
 */

export const UNTRACKED_AVAILABLE = 99_999;

export type GateUnmatchedPolicy = "out_of_stock" | "available";

export type GroundStockGate = {
  /** Master switch. Off = the pre-bridge "never out of stock" storefront. */
  enabled: boolean;
  /** What a counted-kind variant with no Ground Stock row reads as. */
  unmatched: GateUnmatchedPolicy;
};

export const DEFAULT_GROUND_STOCK_GATE: GroundStockGate = {
  enabled: true,
  unmatched: "out_of_stock",
};

const STRICT_KINDS = new Set(["uniform", "accessory", "consumable"]);
const SHEET_KINDS = new Set(["book"]);

/** True for kinds whose availability the Ground Stock figure decides. */
export function isCountedKind(kind: string | null | undefined): boolean {
  return STRICT_KINDS.has(kind ?? "") || SHEET_KINDS.has(kind ?? "");
}

/** True for kinds where a missing Ground Stock row means "sold out". */
export function isStrictKind(kind: string | null | undefined): boolean {
  return STRICT_KINDS.has(kind ?? "");
}

export type AvailabilityInput = {
  kind: string | null | undefined;
  /**
   * actual − reserved from the variant's bins, or null when the variant has
   * no bin at all (the bridge never matched it and no admin ever counted it).
   */
  binAvailable: number | null;
  gate: GroundStockGate;
};

/** Units the storefront may sell. Never negative. */
export function availabilityFor(input: AvailabilityInput): number {
  const { kind, binAvailable, gate } = input;
  if (!gate.enabled) return UNTRACKED_AVAILABLE;
  if (!isCountedKind(kind)) return UNTRACKED_AVAILABLE;
  if (binAvailable != null) return Math.max(0, binAvailable);
  if (isStrictKind(kind)) {
    return gate.unmatched === "available" ? UNTRACKED_AVAILABLE : 0;
  }
  return UNTRACKED_AVAILABLE;
}

/** Parse whatever is stored in system_settings into a well-formed gate. */
export function parseGroundStockGate(value: unknown): GroundStockGate {
  if (!value || typeof value !== "object") return DEFAULT_GROUND_STOCK_GATE;
  const o = value as Record<string, unknown>;
  return {
    enabled:
      typeof o.enabled === "boolean"
        ? o.enabled
        : DEFAULT_GROUND_STOCK_GATE.enabled,
    unmatched:
      o.unmatched === "available" || o.unmatched === "out_of_stock"
        ? o.unmatched
        : DEFAULT_GROUND_STOCK_GATE.unmatched,
  };
}
