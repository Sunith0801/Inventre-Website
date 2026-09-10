import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orderItems } from "@/db/schema";

/**
 * Server-side "you can't ask for more than you bought" guard, shared by the
 * exchange (`createExchange`) and missing-item (`createMissingClaim`) paths.
 *
 * The pickers clamp the Qty box client-side, but that cap is ADVISORY: an
 * `<input max>` is trivially bypassed (typed value, paste, or a hand-rolled
 * POST). This resolves what was actually ordered — per standalone line AND
 * per Magic-Box / kit component — and reports every line that asks for more.
 *
 * Deliberately CONSERVATIVE: a component we can't resolve to an ordered
 * quantity (a bookkit leaf book, a recovered-composition box whose
 * `bundle_selections` never stored the component, an empty variantId) is
 * left UNCAPPED rather than guessed at. Defaulting those to 1 would reject
 * legitimate claims — e.g. a category of books where two copies of the same
 * title genuinely shipped — and the other gates (ownership, delivered,
 * held-back, per-component lock) still apply to them.
 */

export type RequestedQtyLine = {
  orderItemId: string;
  /** Quantity the customer is asking for on this line. */
  qty: number;
  /** Magic-Box / kit component this line refers to, when it is one. */
  componentPath?: Record<string, unknown> | null;
};

export type QtyOverage = {
  orderItemId: string;
  /** Customer-facing name of the offending line / component. */
  name: string;
  asked: number;
  ordered: number;
};

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function readString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Resolve the ordered quantity for every requested line and return the ones
 * that exceed it. An unknown order_item (caught by the callers' own
 * belongs-to-this-order guard) and an unresolvable component are both
 * skipped — this function only ever reports a DEFINITE overage.
 */
export async function findQtyOverages(
  orderId: string,
  lines: RequestedQtyLine[],
): Promise<QtyOverage[]> {
  if (lines.length === 0) return [];

  const rows = await db
    .select({
      id: orderItems.id,
      name: orderItems.nameSnapshot,
      qty: orderItems.qty,
      bundleSelections: orderItems.bundleSelections,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const overages: QtyOverage[] = [];
  for (const line of lines) {
    const row = byId.get(line.orderItemId);
    if (!row) continue; // not on this order — the callers reject it already

    const path = line.componentPath ?? null;
    const compName = path ? readString(path.componentName) : "";

    let ordered: number | null = null;
    let name = row.name;

    if (!path) {
      // Standalone line (a composed line with no component path is rejected
      // outright by the whole-box guard before we get here).
      ordered = row.qty;
    } else {
      name = compName || row.name;
      const comps = Array.isArray(row.bundleSelections)
        ? (row.bundleSelections as Array<Record<string, unknown>>)
        : [];
      const wantVid = readString(path.variantId).toLowerCase();
      const wantName = normName(compName);
      const match =
        (wantVid
          ? comps.find(
              (c) => readString(c.variantId).toLowerCase() === wantVid,
            )
          : undefined) ??
        // Fall back to the component NAME: a "current size unknown" exchange
        // sends the size the parent picked as `variantId`, which won't match
        // the stored one, and legacy rows store an SKU there.
        (wantName
          ? comps.find((c) => normName(readString(c.name)) === wantName)
          : undefined);
      const compQty = match && typeof match.qty === "number" ? match.qty : null;
      // × the line qty: a box ordered twice contains twice its components.
      if (compQty !== null && compQty > 0) ordered = compQty * row.qty;
      // else: unresolved component → leave uncapped (see file header).
    }

    if (ordered !== null && line.qty > ordered) {
      overages.push({ orderItemId: line.orderItemId, name, asked: line.qty, ordered });
    }
  }
  return overages;
}

/** `Quantity exceeds what was ordered: SMS Caps (asked 2, ordered 1)` */
export function formatQtyOverageError(overages: QtyOverage[]): string {
  const parts = overages.map(
    (o) => `${o.name} (asked ${o.asked}, ordered ${o.ordered})`,
  );
  return `Quantity exceeds what was ordered: ${parts.join("; ")}`;
}
