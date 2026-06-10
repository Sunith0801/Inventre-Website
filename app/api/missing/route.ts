import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { missingItemClaims } from "@/db/schema";
import { requireParent, isResponse } from "@/lib/parent-guard";
import { isExchangeTester } from "@/lib/exchange-gate";
import { createMissingClaim } from "@/lib/missing";
import { failJson } from "@/lib/observability/fail-json";

/**
 * Customer-raised missing-item claim endpoint. Mirrors /api/returns but
 * for items that never arrived. Phone-gated to EXCHANGE_TESTER_PHONES
 * for the initial rollout (shared allowlist with exchanges).
 */

const PhotoSchema = z.object({
  url: z.string().url(),
  key: z.string().min(1),
  category: z.string().max(40).optional(),
  caption: z.string().max(200).optional(),
});

const ComponentPathSchema = z.object({
  variantId: z.string().uuid(),
  componentName: z.string().max(200).optional(),
  attributes: z
    .array(z.object({ name: z.string().max(40), value: z.string().max(80) }))
    .optional(),
});

const Body = z.object({
  orderId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
  photos: z.array(PhotoSchema).max(5).default([]),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        qtyShort: z.number().int().min(1).max(50),
        missingComponentPath: ComponentPathSchema.optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export async function GET() {
  const me = await requireParent();
  if (isResponse(me)) return me;
  const rows = await db
    .select()
    .from(missingItemClaims)
    .where(eq(missingItemClaims.parentId, me.id))
    .orderBy(desc(missingItemClaims.createdAt));
  return NextResponse.json({ claims: rows });
}

export async function POST(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;
  if (!isExchangeTester(me.phone)) {
    return failJson({
      parentId: me.id, req, status: 403,
      message: "Missing-item claims are not available for this account yet.",
      kind: "rule.block",
      details: { gate: "exchange-tester-phone" },
    });
  }

  const json = await req.json().catch(() => null);
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(json);
  } catch (e) {
    return failJson({
      parentId: me.id, req, status: 400,
      message: "Invalid request", kind: "api.4xx",
      details: { zodError: (e as Error).message },
    });
  }

  const result = await createMissingClaim({
    parentId: me.id,
    orderId: body.orderId,
    notes: body.notes ?? null,
    photos: body.photos,
    items: body.items.map((i) => ({
      orderItemId: i.orderItemId,
      qtyShort: i.qtyShort,
      missingComponentPath: i.missingComponentPath ?? null,
      notes: i.notes ?? null,
    })),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    );
  }
  return NextResponse.json({
    id: result.id,
    claimNumber: result.claimNumber,
    pickupDate: result.pickupDate,
  });
}
