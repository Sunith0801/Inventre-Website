import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import {
  requirePermission,
  isResponse,
  assertSchoolAccess,
} from "@/lib/admin-guard";
import { logActivity } from "@/lib/activity";
import { createExchange } from "@/lib/exchange";

/**
 * SPOC / staff-raised EXCHANGE on behalf of a parent.
 *
 * Mirrors the parent-facing POST /api/returns flow (same validation +
 * createExchange reuse: delivered-status gate, item ownership, one-open-
 * request block, ERP emit, SMS) but authorises differently:
 *
 *   - gate: requirePermission("spoc-exchange.write") instead of the parent
 *     session + EXCHANGE_TESTER_PHONES allowlist.
 *   - SCHOOL SCOPE: assertSchoolAccess confines a school_admin / SPOC to
 *     their own school's orders (no-op for super/ops). This is the single
 *     check that keeps a SPOC inside their school.
 *
 * parentId is taken from the order itself, never from the actor, so the
 * exchange is always attributed to the real customer.
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
  notes: z.string().max(2000).optional(),
});

const Body = z.object({
  orderId: z.string().uuid(),
  // Photos optional for staff-raised exchanges (a SPOC may log a request the
  // parent reported without images on hand) — unlike the parent flow which
  // requires at least one. Capped at 5 like the parent flow.
  photos: z.array(PhotoSchema).max(5).optional(),
  notes: z.string().max(2000).optional(),
  perItem: z.array(PerItemSchema).min(1).max(50),
});

export async function POST(req: Request) {
  const guard = await requirePermission("spoc-exchange.write");
  if (isResponse(guard)) return guard;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join("; ")
        : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const [order] = await db
    .select({
      id: orders.id,
      parentId: orders.parentId,
      schoolId: orders.schoolId,
      orderNumber: orders.orderNumber,
    })
    .from(orders)
    .where(eq(orders.id, body.orderId))
    .limit(1);
  if (!order)
    return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // The load-bearing authorisation: a SPOC (school_admin) can only raise
  // exchanges for their own school. No-op for super/ops.
  const schoolBlock = assertSchoolAccess(guard, order.schoolId);
  if (schoolBlock) return schoolBlock;

  const result = await createExchange({
    parentId: order.parentId,
    orderId: order.id,
    notes: body.notes ?? null,
    photos: body.photos ?? [],
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
      notes: i.notes ?? null,
    })),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status }
    );
  }

  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "exchange.create",
    entityType: "return",
    entityId: result.id,
    summary: `Exchange ${result.returnNumber} raised on behalf for order ${order.orderNumber} (by ${guard.email})`,
  });

  return NextResponse.json({
    id: result.id,
    returnNumber: result.returnNumber,
    pickupDate: result.pickupDate,
  });
}
