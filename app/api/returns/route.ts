import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { failJson } from "@/server/observability/fail-json";
import { db } from "@/db/client";
import { returns } from "@/db/schema";
import { requireParent, isResponse } from "@/server/parent-guard";
import { isExchangeTester } from "@/server/exchange-gate";
import { createExchange } from "@/server/exchange";

const PhotoSchema = z.object({
  url: z.string().url(),
  key: z.string().min(1),
  // Phase-2: photo category + caption (optional so Phase-1 callers still work).
  category: z.string().max(40).optional(),
  caption: z.string().max(200).optional(),
});

const ComponentPathSchema = z.object({
  // NOT constrained to a UUID: this is opaque descriptive metadata for
  // customer care (it identifies WHICH component in a Magic Box / kit the
  // request is about), never dereferenced as a variant FK. Legacy and
  // backfilled `order_items.bundle_selections` store the component's SKU
  // string here — and recovered-composition boxes may store an empty
  // string — so `.uuid()` would wrongly reject ~5.5k live components and
  // surface as "Invalid request" on submit. The real swap target is the
  // strict-UUID `requestedVariantId` at the item level.
  variantId: z.string().max(200),
  componentName: z.string().max(200).optional(),
  attributes: z.array(z.object({
    name: z.string().max(40),
    value: z.string().max(80),
  })).optional(),
});

// Per-component request shape. The customer may flag multiple components
// inside one order_item (Magic Box / kit), each with its own reason.
const PerItemSchema = z.object({
  orderItemId: z.string().uuid(),
  qty: z.number().int().min(1),
  condition: z.enum(["unopened", "opened", "damaged"]).optional(),
  reason: z.string().min(1).max(500),
  subReason: z.string().max(80).optional(),
  damageLocation: z.string().max(40).optional(),
  replacementMode: z
    .enum(["sibling", "same_fresh", "different_describe"])
    .optional(),
  requestedVariantId: z.string().uuid().optional(),
  requestedComponentPath: ComponentPathSchema.optional(),
  // Explicit colour/size change (2026-07-09) — the customer's original and
  // requested colour/size for a wrong-colour / wrong-size exchange. Stored
  // alongside the resolved requestedVariantId so customer-care sees exactly
  // what to swap. All optional / nullable (books & non-variant items omit it).
  variantChange: z
    .object({
      originalColor: z.string().max(80).nullable().optional(),
      originalSize: z.string().max(80).nullable().optional(),
      requestedColor: z.string().max(80).nullable().optional(),
      requestedSize: z.string().max(80).nullable().optional(),
    })
    .optional(),
  notes: z.string().max(2000).optional(),
});

const Body = z.object({
  orderId: z.string().uuid(),
  // `kind` is required from this entry-point now — the existing refund
  // path is admin-only and goes through /api/admin/returns. The
  // customer-raised flow is exchange-only.
  kind: z.literal("exchange"),
  // Photos are at the request level — they belong to the whole RTN bundle.
  // The form intentionally allows unlimited photos per section (see
  // ExchangeForm "No count cap"); a low `.max(5)` here rejected any
  // 6+-photo submission as "Invalid request". Keep a generous upper bound
  // purely as a payload-abuse guard.
  photos: z.array(PhotoSchema).min(1).max(50),
  // Optional combined free-form notes (the form composes these from each
  // per-item tab so customer-care sees one block on the head row).
  notes: z.string().max(2000).optional(),
  // Per-item reasons + replacement choices. At least one.
  perItem: z.array(PerItemSchema).min(1).max(50),
});

export async function GET() {
  const me = await requireParent();
  if (isResponse(me)) return me;
  const rows = await db
    .select()
    .from(returns)
    .where(eq(returns.parentId, me.id))
    .orderBy(desc(returns.createdAt));
  return NextResponse.json({ returns: rows });
}

export async function POST(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;

  // Phone-gated rollout. Non-allowlisted parents see a 403 from this
  // endpoint — but the storefront also hides the entry point for them,
  // so reaching here means a hand-crafted request. Returning a stable
  // 403 (not 404) is fine since the existence of the endpoint isn't
  // sensitive.
  if (!isExchangeTester(me.phone)) {
    return failJson({
      parentId: me.id, req, status: 403,
      message: "Exchange flow is not available for this account yet.",
      kind: "rule.block",
      details: { gate: "exchange-tester-phone" },
    });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return failJson({
      parentId: me.id, req, status: 400,
      message: "Invalid request", kind: "api.4xx",
      details: { zodError: (e as Error).message },
    });
  }

  const result = await createExchange({
    parentId: me.id,
    orderId: body.orderId,
    notes: body.notes ?? null,
    photos: body.photos,
    items: body.perItem.map((i) => ({
      orderItemId: i.orderItemId,
      qty: i.qty,
      condition: i.condition ?? null,
      reason: i.reason,
      subReason: i.subReason ?? null,
      damageLocation: i.damageLocation ?? null,
      replacementMode: i.replacementMode ?? null,
      requestedVariantId: i.requestedVariantId ?? null,
      requestedComponentPath: i.requestedComponentPath ?? null,
      variantChange: i.variantChange ?? null,
      notes: i.notes ?? null,
    })),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status }
    );
  }

  return NextResponse.json({
    id: result.id,
    returnNumber: result.returnNumber,
    pickupDate: result.pickupDate,
  });
}
