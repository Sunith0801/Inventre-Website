import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  productVariants,
  returns,
  returnItems,
  missingItemClaims,
  missingItemClaimItems,
} from "@/db/schema";
import { allocReturnNumber, allocClaimNumber } from "@/server/numbering";
import { firstPickupSaturday, toDbDate } from "@/lib/date";
import { isExchangeStatus } from "@/lib/exchange-shared";
import { getHeldBackOrderItemIds } from "@/server/return-line-eligibility";
import {
  buildOrderMatchIndex,
  matchAuditItem,
  type ComponentPath,
} from "@/server/audit-item-match";

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
    // Clean product name (e.g. "SMS Sports Polo"). Sent by the backfill and
    // newer audit builds; lets the matcher link a magic-box COMPONENT to the
    // box parent's bundle_selections. Falls back to prefix-matching item_code
    // when absent (older webhook payloads). See lib/audit-item-match.ts.
    item_name?: string;
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
  items?: Array<{
    item_code?: string;
    item_name?: string;
    delivered_size?: string;
    qty_short?: number;
    line_notes?: string;
  }>;
}

export interface InboundResult {
  status: number;
  body: Record<string, unknown>;
}

export interface AuditCreateOpts {
  /** Skip the held-back (not-yet-delivered per our shipment mirror) filter.
   *  Used by the one-off backfill of already-approved Customer-Care requests,
   *  whose delivery is a settled fact in audit and whose inventre shipment
   *  mirror is often stale/incomplete. The live webhook leaves it OFF so a
   *  genuinely-new manual entry still can't attach an undelivered line. */
  skipHeldBack?: boolean;
}

export async function createExchangeFromAudit(
  p: AuditExchangeCreate,
  opts?: AuditCreateOpts
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

  const idx = await buildOrderMatchIndex(ord.id);
  const matched: Array<{
    orderItemId: string;
    variantId: string;
    qty: number;
    replacementMode: string | null;
    requestedVariantId: string | null;
    requestedComponentPath: ComponentPath | null;
    notes: string | null;
  }> = [];
  const unmatched: string[] = [];
  for (const it of p.items ?? []) {
    const code = it.item_code?.trim();
    const line = matchAuditItem(idx, it);
    if (!line) {
      if (code) unmatched.push(code);
      continue;
    }
    matched.push({
      orderItemId: line.orderItemId,
      variantId: line.variantId,
      qty: Math.max(1, Number(it.qty ?? 1)),
      replacementMode: it.replacement_mode ?? null,
      requestedVariantId: await variantIdByCode(it.requested_variant_item_code),
      requestedComponentPath: line.componentPath,
      notes: it.line_notes ?? null,
    });
  }
  // Held-back lines (out of stock / not yet delivered per our own shipment
  // mirror) can't be exchanged — drop them even when audit sent them, so a
  // manual audit entry can't attach a line the customer hasn't received.
  const heldSkipped: string[] = [];
  if (!opts?.skipHeldBack) {
    const heldBack = await getHeldBackOrderItemIds(ord.id, p.so_erp_name ?? "");
    for (let i = matched.length - 1; i >= 0; i--) {
      if (heldBack.has(matched[i].orderItemId)) {
        heldSkipped.push(matched[i].orderItemId);
        matched.splice(i, 1);
      }
    }
  }
  if (matched.length === 0)
    return {
      status: 422,
      body: {
        error: "No eligible order items matched the audit item codes",
        unmatched,
        heldBack: heldSkipped,
      },
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
        // Raised by Customer Care in Audit → drives the storefront
        // "…by the Customer Care Team" duplicate popup (Condition 4).
        source: "care_team",
        pickupDate,
        reason: p.reason ?? null,
        subReason: p.sub_reason ?? null,
        notes: p.notes ?? null,
        status,
        itemIds: matched.map((m) => m.orderItemId),
        requestedVariantId: primary.requestedVariantId,
        requestedComponentPath: primary.requestedComponentPath,
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
        // Per-component identity for magic-box lines so the storefront labels
        // each part correctly (mirrors the customer-raised flow). Null for
        // standalone lines.
        requestedComponentPath: m.requestedComponentPath,
        notes: m.notes,
      }))
    );
    return created;
  });

  return {
    status: 200,
    body: { ok: true, id: ret.id, returnNumber, unmatched, heldBack: heldSkipped },
  };
}

export async function createMissingFromAudit(
  p: AuditMissingCreate,
  opts?: AuditCreateOpts
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

  const idx = await buildOrderMatchIndex(ord.id);
  const matched: Array<{
    orderItemId: string;
    qtyShort: number;
    missingComponentPath: ComponentPath | null;
    notes: string | null;
  }> = [];
  const unmatched: string[] = [];
  for (const it of p.items ?? []) {
    const code = it.item_code?.trim();
    const line = matchAuditItem(idx, it);
    if (!line) {
      if (code) unmatched.push(code);
      continue;
    }
    matched.push({
      orderItemId: line.orderItemId,
      qtyShort: Math.max(1, Number(it.qty_short ?? 1)),
      missingComponentPath: line.componentPath,
      notes: it.line_notes ?? null,
    });
  }
  // Held-back lines (out of stock / not yet delivered) aren't "missing" —
  // we already know and will ship them later — so drop them even when a
  // manual audit entry references them.
  const heldSkipped: string[] = [];
  if (!opts?.skipHeldBack) {
    const heldBack = await getHeldBackOrderItemIds(ord.id, p.so_erp_name ?? "");
    for (let i = matched.length - 1; i >= 0; i--) {
      if (heldBack.has(matched[i].orderItemId)) {
        heldSkipped.push(matched[i].orderItemId);
        matched.splice(i, 1);
      }
    }
  }
  if (matched.length === 0)
    return {
      status: 422,
      body: {
        error: "No eligible order items matched the audit item codes",
        unmatched,
        heldBack: heldSkipped,
      },
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
        // Raised by Customer Care in Audit (Condition 4).
        source: "care_team",
        notes: p.notes ?? null,
        pickupDate,
      })
      .returning();
    await tx.insert(missingItemClaimItems).values(
      matched.map((m) => ({
        claimId: created.id,
        orderItemId: m.orderItemId,
        qtyShort: m.qtyShort,
        // Per-component identity for magic-box lines (null for standalone).
        missingComponentPath: m.missingComponentPath,
        notes: m.notes,
      }))
    );
    return created;
  });

  return {
    status: 200,
    body: { ok: true, id: head.id, claimNumber, unmatched, heldBack: heldSkipped },
  };
}
