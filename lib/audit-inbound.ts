import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  productVariants,
  products,
  returns,
  returnItems,
  missingItemClaims,
  missingItemClaimItems,
} from "@/db/schema";
import { allocReturnNumber, allocClaimNumber } from "@/lib/numbering";
import { firstPickupSaturday, toDbDate } from "@/lib/date";
import { isExchangeStatus } from "@/lib/exchange-shared";

/**
 * Inbound "create" path for exchanges / missing-item claims that ORIGINATE
 * in audit.inventre.in (customer-care's manual "add exchange" / "add
 * missing" on /exchange-requests).
 *
 * The status-flip webhooks (lib's transitionExchangeStatus etc.) only mutate
 * an EXISTING local row — they can't represent an audit-originated request
 * because no `returns` / `missing_item_claims` row exists yet. These helpers
 * create that row so the parent sees the request on /shop/orders/[id].
 *
 * Crucially these do NOT re-emit to audit (unlike lib/exchange.createExchange),
 * because the audit row is the source — emitting back would loop / duplicate.
 *
 * Item linkage: audit sends opaque `item_code`s (its own SKU naming). We
 * reverse-match each against the order's lines using the SAME key the
 * outbound bridge used to label them (lib/erp-bridge.resolveItemCode), so the
 * round-trip is symmetric. Lines that don't match are reported back as
 * `unmatched` and dropped (the chosen "match by code" strategy).
 */

const computePickup = (): string => toDbDate(firstPickupSaturday(new Date()));

/**
 * Single-source-of-truth rollout switch.
 *
 * When `true`, Inventre ALWAYS mints the request number (RTN-/MIS-{year}-{seq})
 * and IGNORES any number audit sends — audit must adopt the number Inventre
 * returns. This retires audit's legacy "-M-" format for all NEW requests.
 *
 * Default `false` keeps the legacy behaviour (use audit's number if it sends
 * one) so this can ship to prod with ZERO behaviour change, then be flipped
 * ON in lockstep with the audit-side change that stops audit from generating
 * its own number. Flipping it before audit is updated would desync the two
 * systems' numbers on new audit-created requests, so they must go together.
 */
function inventreMintsNumbers(): boolean {
  return process.env.RETURNS_NUMBER_SINGLE_SOURCE === "true";
}

// Mirror of lib/erp-bridge.ts resolveItemCode — keep in sync.
function resolveItemCode(
  v: { id: string; erpName: string | null; sku: string | null },
  p: { erpName: string | null; itemCode: string | null }
): string {
  return v.erpName ?? v.sku ?? p.erpName ?? p.itemCode ?? v.id;
}

interface OrderLine {
  orderItemId: string;
  variantId: string;
  size: string | null;
}

/** Build code → [lines] for an order, skipping ERP-orphan lines (no variant). */
async function loadOrderItemMap(orderId: string): Promise<Map<string, OrderLine[]>> {
  const rows = await db
    .select({
      orderItemId: orderItems.id,
      size: orderItems.size,
      variantId: orderItems.variantId,
      vErpName: productVariants.erpName,
      vSku: productVariants.sku,
      pErpName: products.erpName,
      pItemCode: products.itemCode,
    })
    .from(orderItems)
    .leftJoin(productVariants, eq(orderItems.variantId, productVariants.id))
    .leftJoin(products, eq(productVariants.productId, products.id))
    .where(eq(orderItems.orderId, orderId));

  const byCode = new Map<string, OrderLine[]>();
  for (const r of rows) {
    if (!r.variantId) continue; // ERP-imported orphan — can't link a return item
    const code = resolveItemCode(
      { id: r.variantId, erpName: r.vErpName, sku: r.vSku },
      { erpName: r.pErpName, itemCode: r.pItemCode }
    );
    const arr = byCode.get(code) ?? [];
    arr.push({ orderItemId: r.orderItemId, variantId: r.variantId, size: r.size });
    byCode.set(code, arr);
  }
  return byCode;
}

/** Pick a line for an audit item, disambiguating by delivered_size when present. */
function pickLine(cands: OrderLine[], deliveredSize?: string | null): OrderLine {
  if (deliveredSize) {
    const m = cands.find(
      (c) => (c.size ?? "").toLowerCase() === deliveredSize.toLowerCase()
    );
    if (m) return m;
  }
  return cands[0];
}

async function variantIdByCode(code?: string | null): Promise<string | null> {
  const c = code?.trim();
  if (!c) return null;
  const [v] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(or(eq(productVariants.erpName, c), eq(productVariants.sku, c)))
    .limit(1);
  return v?.id ?? null;
}

async function resolveOrder(
  soErpName?: string
): Promise<
  | { ok: true; id: string; parentId: string }
  | { ok: false; status: number; error: string }
> {
  const soName = soErpName?.trim();
  if (!soName) return { ok: false, status: 400, error: "so_erp_name required" };
  const [order] = await db
    .select({ id: orders.id, parentId: orders.parentId })
    .from(orders)
    .where(eq(orders.erpSoName, soName))
    .limit(1);
  if (!order)
    return { ok: false, status: 404, error: `Order ${soName} not found in inventre` };
  if (!order.parentId)
    return { ok: false, status: 409, error: "Order has no parent in inventre" };
  return { ok: true, id: order.id, parentId: order.parentId };
}

export interface AuditExchangeCreate {
  audit_ref?: string;
  /** @deprecated IGNORED — Inventre is the sole minter. Adopt the
   *  `returnNumber` from the response instead. Kept only so older audit
   *  builds that still send it don't fail schema-wise. */
  return_number?: string;
  so_erp_name?: string;
  status?: string;
  reason?: string;
  sub_reason?: string;
  notes?: string;
  pickup_date?: string;
  items?: Array<{
    item_code?: string;
    delivered_size?: string;
    qty?: number;
    replacement_mode?: string;
    requested_variant_item_code?: string;
    line_notes?: string;
  }>;
}

export interface AuditMissingCreate {
  audit_ref?: string;
  /** @deprecated IGNORED — Inventre is the sole minter. Adopt the
   *  `claimNumber` from the response instead. */
  claim_number?: string;
  so_erp_name?: string;
  status?: string;
  notes?: string;
  items?: Array<{ item_code?: string; qty_short?: number; line_notes?: string }>;
}

export interface InboundResult {
  status: number;
  body: Record<string, unknown>;
}

export async function createExchangeFromAudit(
  p: AuditExchangeCreate
): Promise<InboundResult> {
  const ord = await resolveOrder(p.so_erp_name);
  if (!ord.ok) return { status: ord.status, body: { error: ord.error } };

  // Idempotency: one exchange per order lifetime. If a non-rejected exchange
  // already exists for this order, return it (audit may re-fire on retry).
  const existing = await db
    .select({ id: returns.id, status: returns.status, returnNumber: returns.returnNumber })
    .from(returns)
    .where(and(eq(returns.orderId, ord.id), eq(returns.kind, "exchange")));
  const live = existing.find((r) => r.status !== "rejected");
  if (live)
    return {
      status: 200,
      body: { ok: true, id: live.id, returnNumber: live.returnNumber, deduped: true },
    };

  const byCode = await loadOrderItemMap(ord.id);
  const matched: Array<{
    orderItemId: string;
    variantId: string;
    qty: number;
    replacementMode: string | null;
    requestedVariantId: string | null;
    notes: string | null;
  }> = [];
  const unmatched: string[] = [];
  for (const it of p.items ?? []) {
    const code = it.item_code?.trim();
    if (!code) continue;
    const cands = byCode.get(code);
    if (!cands || cands.length === 0) {
      unmatched.push(code);
      continue;
    }
    const line = pickLine(cands, it.delivered_size);
    matched.push({
      orderItemId: line.orderItemId,
      variantId: line.variantId,
      qty: Math.max(1, Number(it.qty ?? 1)),
      replacementMode: it.replacement_mode ?? null,
      requestedVariantId: await variantIdByCode(it.requested_variant_item_code),
      notes: it.line_notes ?? null,
    });
  }
  if (matched.length === 0)
    return {
      status: 422,
      body: { error: "No order items matched the audit item codes", unmatched },
    };

  const status = isExchangeStatus(p.status) ? p.status : "requested";
  // Inventre is the sole minter when the single-source switch is on (it then
  // IGNORES audit's number; audit adopts the one returned below). Off → legacy
  // pass-through. Either way existing RTN-M-… rows are untouched.
  const returnNumber = inventreMintsNumbers()
    ? await allocReturnNumber()
    : p.return_number?.trim() || (await allocReturnNumber());
  const pickupDate = p.pickup_date?.trim() || computePickup();
  const primary = matched[0];

  const ret = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(returns)
      .values({
        orderId: ord.id,
        parentId: ord.parentId,
        returnNumber,
        kind: "exchange",
        pickupDate,
        reason: p.reason ?? null,
        subReason: p.sub_reason ?? null,
        notes: p.notes ?? null,
        status,
        itemIds: matched.map((m) => m.orderItemId),
        requestedVariantId: primary.requestedVariantId,
        replacementMode: primary.replacementMode,
      })
      .returning();
    await tx.insert(returnItems).values(
      matched.map((m) => ({
        returnId: created.id,
        orderItemId: m.orderItemId,
        variantId: m.variantId,
        qty: m.qty,
        reason: p.reason ?? null,
        replacementMode: m.replacementMode,
        requestedVariantId: m.requestedVariantId,
        notes: m.notes,
      }))
    );
    return created;
  });

  return { status: 200, body: { ok: true, id: ret.id, returnNumber, unmatched } };
}

export async function createMissingFromAudit(
  p: AuditMissingCreate
): Promise<InboundResult> {
  const ord = await resolveOrder(p.so_erp_name);
  if (!ord.ok) return { status: ord.status, body: { error: ord.error } };

  const existing = await db
    .select({ id: missingItemClaims.id, status: missingItemClaims.status, claimNumber: missingItemClaims.claimNumber })
    .from(missingItemClaims)
    .where(eq(missingItemClaims.orderId, ord.id));
  const live = existing.find((r) => r.status !== "rejected");
  if (live)
    return {
      status: 200,
      body: { ok: true, id: live.id, claimNumber: live.claimNumber, deduped: true },
    };

  const byCode = await loadOrderItemMap(ord.id);
  const matched: Array<{ orderItemId: string; qtyShort: number; notes: string | null }> = [];
  const unmatched: string[] = [];
  for (const it of p.items ?? []) {
    const code = it.item_code?.trim();
    if (!code) continue;
    const cands = byCode.get(code);
    if (!cands || cands.length === 0) {
      unmatched.push(code);
      continue;
    }
    matched.push({
      orderItemId: cands[0].orderItemId,
      qtyShort: Math.max(1, Number(it.qty_short ?? 1)),
      notes: it.line_notes ?? null,
    });
  }
  if (matched.length === 0)
    return {
      status: 422,
      body: { error: "No order items matched the audit item codes", unmatched },
    };

  const VALID = ["requested", "approved", "rejected", "received_at_school", "delivered"];
  const status = typeof p.status === "string" && VALID.includes(p.status) ? p.status : "requested";
  // Inventre is the sole minter when the single-source switch is on (it then
  // IGNORES audit's number; audit adopts the one returned below). Off → legacy
  // pass-through. Existing MIS-M-… rows are untouched.
  const claimNumber = inventreMintsNumbers()
    ? await allocClaimNumber()
    : p.claim_number?.trim() || (await allocClaimNumber());
  const pickupDate = computePickup();

  const head = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(missingItemClaims)
      .values({
        orderId: ord.id,
        parentId: ord.parentId,
        claimNumber,
        status,
        notes: p.notes ?? null,
        pickupDate,
      })
      .returning();
    await tx.insert(missingItemClaimItems).values(
      matched.map((m) => ({
        claimId: created.id,
        orderItemId: m.orderItemId,
        qtyShort: m.qtyShort,
        notes: m.notes,
      }))
    );
    return created;
  });

  return { status: 200, body: { ok: true, id: head.id, claimNumber, unmatched } };
}
