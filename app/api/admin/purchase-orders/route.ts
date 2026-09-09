import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";
import {
  createPurchaseOrder,
  listPurchaseOrders,
} from "@/lib/repos/purchase-orders";

export async function GET(req: Request) {
  const guard = await requirePermission("purchase-orders.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  return NextResponse.json({ purchaseOrders: await listPurchaseOrders({ status }) });
}

const Body = z.object({
  supplierId: z.string().uuid(),
  orderDate: z.string(),
  expectedDate: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid().nullable().optional(),
        description: z.string().min(1),
        qty: z.number().int().min(1),
        unitPrice: z.number().int().min(0), // paise
      })
    )
    .min(1),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("purchase-orders.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const po = await createPurchaseOrder({ ...body, createdBy: guard.id });
  void logAdminActivity(guard, {
    action: "purchase_order.create",
    entityType: "purchase_order",
    entityId: po.id,
    summary: `Created purchase order ${po.poNumber}`,
    req,
  });
  return NextResponse.json({ id: po.id, poNumber: po.poNumber });
}
