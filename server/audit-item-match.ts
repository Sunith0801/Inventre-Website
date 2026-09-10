import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orderItems, productVariants, products } from "@/db/schema";

/**
 * Resolve audit-sent item references to LOCAL order lines — the single
 * matcher shared by the inbound webhook (lib/audit-inbound.ts) and the
 * one-off backfill (scripts/backfill-audit-manual-requests.ts) so both
 * stay in lockstep.
 *
 * Two match modes:
 *   1. STANDALONE line — audit's `item_code` exactly equals the code the
 *      outbound bridge labelled the line with (variant erp_name/sku →
 *      product erp_name/item_code). The historical behaviour.
 *   2. MAGIC-BOX / bundle COMPONENT — audit ships one item per box
 *      component (e.g. "SMS Sports Polo"), NOT the box itself. Its
 *      `item_code` is an ERPNext variant code like `SMS Sports PoloB28$$`
 *      whose leading text is the component's product name, and its
 *      `item_name` is that clean name ("SMS Sports Polo"). Inventre has no
 *      order_items row per component — the components live in the box
 *      parent's `bundle_selections`. So we index every component and match
 *      by name, then attach the request line to the PARENT order_item with
 *      a `componentPath` (mirrors how the customer-raised flow stores a
 *      per-component return: parent order_item id + parent variant id +
 *      requested_component_path = {variantId, attributes, componentName}).
 *
 * Component match is by NAME (robust) not by the `$`-suffixed variant code
 * (audit's colour letter can differ from ours, e.g. it sent `B28` where we
 * store `A28`): the component's `name` must equal `item_name` OR be a
 * prefix of `item_code`. When several components share a name, disambiguate
 * by `delivered_size`. When several names prefix-match, the LONGEST wins.
 */

export interface AuditItemRef {
  item_code?: string | null;
  item_name?: string | null;
  delivered_size?: string | null;
}

export interface ComponentPath {
  variantId: string | null;
  attributes: unknown[];
  componentName: string;
}

export interface ResolvedLine {
  /** Local order_items.id the request line attaches to (the box PARENT for
   *  a bundle component, else the line itself). */
  orderItemId: string;
  /** variant_id to stamp on the return/claim item row — the PARENT box
   *  variant for a component, the line's own variant for a standalone. */
  variantId: string;
  /** Set only for a bundle component; null for a standalone line. */
  componentPath: ComponentPath | null;
}

interface StandaloneLine {
  orderItemId: string;
  variantId: string;
  size: string | null;
}

interface BundleComponent {
  parentOrderItemId: string;
  parentVariantId: string;
  name: string;
  size: string | null;
  variantId: string | null;
  attributes: unknown[];
}

function resolveItemCode(
  v: { id: string; erpName: string | null; sku: string | null },
  p: { erpName: string | null; itemCode: string | null }
): string {
  return v.erpName ?? v.sku ?? p.erpName ?? p.itemCode ?? v.id;
}

interface OrderMatchIndex {
  /** exact code → standalone candidate lines */
  byCode: Map<string, StandaloneLine[]>;
  /** every bundle component across the order's lines */
  components: BundleComponent[];
}

/** Build the match index for one order (standalone codes + bundle components). */
export async function buildOrderMatchIndex(orderId: string): Promise<OrderMatchIndex> {
  const rows = await db
    .select({
      orderItemId: orderItems.id,
      size: orderItems.size,
      variantId: orderItems.variantId,
      bundleSelections: orderItems.bundleSelections,
      vErpName: productVariants.erpName,
      vSku: productVariants.sku,
      pErpName: products.erpName,
      pItemCode: products.itemCode,
    })
    .from(orderItems)
    .leftJoin(productVariants, eq(orderItems.variantId, productVariants.id))
    .leftJoin(products, eq(productVariants.productId, products.id))
    .where(eq(orderItems.orderId, orderId));

  const byCode = new Map<string, StandaloneLine[]>();
  const components: BundleComponent[] = [];

  for (const r of rows) {
    if (!r.variantId) continue; // ERP-imported orphan — nothing to link
    const code = resolveItemCode(
      { id: r.variantId, erpName: r.vErpName, sku: r.vSku },
      { erpName: r.pErpName, itemCode: r.pItemCode }
    );
    const arr = byCode.get(code) ?? [];
    arr.push({ orderItemId: r.orderItemId, variantId: r.variantId, size: r.size });
    byCode.set(code, arr);

    // Expand this line's bundle components (magic box / kit / sub-bundle).
    const sel = r.bundleSelections;
    if (Array.isArray(sel)) {
      for (const c of sel as Array<Record<string, unknown>>) {
        const name = typeof c?.name === "string" ? c.name.trim() : "";
        if (!name) continue;
        components.push({
          parentOrderItemId: r.orderItemId,
          parentVariantId: r.variantId,
          name,
          size: typeof c.size === "string" ? c.size : null,
          variantId: typeof c.variantId === "string" ? c.variantId : null,
          attributes: Array.isArray(c.attributes) ? (c.attributes as unknown[]) : [],
        });
      }
    }
  }
  return { byCode, components };
}

/** Match a single audit item ref against the order's index. Returns null if
 *  nothing matched (caller records it as `unmatched`). */
export function matchAuditItem(
  idx: OrderMatchIndex,
  ref: AuditItemRef
): ResolvedLine | null {
  const code = (ref.item_code ?? "").trim();
  const name = (ref.item_name ?? "").trim();
  const size = (ref.delivered_size ?? "").trim().toLowerCase();

  // 1. STANDALONE exact-code match (unchanged historical path).
  if (code) {
    const cands = idx.byCode.get(code);
    if (cands && cands.length > 0) {
      const line =
        (size && cands.find((c) => (c.size ?? "").toLowerCase() === size)) ||
        cands[0];
      return { orderItemId: line.orderItemId, variantId: line.variantId, componentPath: null };
    }
  }

  // 2. BUNDLE COMPONENT match by name (exact item_name, else name is a
  //    prefix of item_code). Longest name wins; then disambiguate by size.
  const nameMatches = (c: BundleComponent): boolean => {
    if (name && c.name === name) return true;
    if (code && code.startsWith(c.name)) return true;
    return false;
  };
  const hits = idx.components
    .filter(nameMatches)
    .sort((a, b) => b.name.length - a.name.length); // longest name first
  if (hits.length > 0) {
    const bestLen = hits[0].name.length;
    const best = hits.filter((h) => h.name.length === bestLen);
    const chosen =
      (size && best.find((c) => (c.size ?? "").toLowerCase() === size)) || best[0];
    return {
      orderItemId: chosen.parentOrderItemId,
      variantId: chosen.parentVariantId,
      componentPath: {
        variantId: chosen.variantId,
        attributes: chosen.attributes,
        componentName: chosen.name,
      },
    };
  }

  return null;
}
