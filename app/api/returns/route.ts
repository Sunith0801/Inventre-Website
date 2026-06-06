import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { returns } from "@/db/schema";
import { requireParent, isResponse } from "@/lib/parent-guard";
import { isExchangeTester } from "@/lib/exchange-gate";
import { createExchange } from "@/lib/exchange";

const PhotoSchema = z.object({
  url: z.string().url(),
  key: z.string().min(1),
});

const Body = z.object({
  orderId: z.string().uuid(),
  // `kind` is required from this entry-point now — the existing refund
  // path is admin-only and goes through /api/admin/returns. The
  // customer-raised flow is exchange-only.
  kind: z.literal("exchange"),
  reason: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
  photos: z.array(PhotoSchema).min(1).max(5),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        qty: z.number().int().min(1),
        condition: z.enum(["unopened", "opened", "damaged"]).optional(),
      })
    )
    .min(1),
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
    return NextResponse.json(
      { error: "Exchange flow is not available for this account yet." },
      { status: 403 }
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid request", details: (e as Error).message },
      { status: 400 }
    );
  }

  const result = await createExchange({
    parentId: me.id,
    orderId: body.orderId,
    reason: body.reason,
    notes: body.notes ?? null,
    photos: body.photos,
    items: body.items.map((i) => ({
      orderItemId: i.orderItemId,
      qty: i.qty,
      condition: i.condition ?? null,
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
