import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { concerns, orders } from "@/db/schema";
import { requireParent, isResponse } from "@/lib/parent-guard";
import { allocConcernNumber } from "@/lib/numbering";
import { emitConcernEvent } from "@/lib/erp-bridge";

/**
 * Parent concern-portal intake (inventre.in/portal).
 *
 * Creates a `concerns` row (Inventre is the source of truth + sole minter of
 * the CON- number) and best-effort pushes it to the Audit call-centre Admin
 * Panel via `concern.created`. Parent-gated; an `orderId` is accepted only if
 * it belongs to the caller (otherwise dropped, not rejected — the concern is
 * still valid without an order).
 */

export const dynamic = "force-dynamic";

const Body = z.object({
  category: z.enum(["payment", "order_delivery", "customer_care"]),
  orderId: z.string().uuid().nullish(),
  description: z.string().trim().min(1, "Please describe the issue").max(4000),
  contactPhone: z.string().trim().max(20).optional(),
});

export async function POST(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Only attach the order if it's the caller's — never trust a client-sent id.
  let orderId: string | null = body.orderId ?? null;
  if (orderId) {
    const [o] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.parentId, me.id)))
      .limit(1);
    if (!o) orderId = null;
  }

  const concernNumber = await allocConcernNumber();
  const [created] = await db
    .insert(concerns)
    .values({
      concernNumber,
      parentId: me.id,
      orderId,
      category: body.category,
      description: body.description,
      contactPhone: body.contactPhone?.trim() || me.loggedInPhone || me.phone || null,
      status: "open",
    })
    .returning();

  // Best-effort push to the audit call-centre — durable record is this row.
  void emitConcernEvent(created.id, "concern.created");

  return NextResponse.json({ ok: true, id: created.id, concernNumber });
}
