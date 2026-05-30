import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import {
  createShipment,
  listShipments,
} from "@/lib/repos/shipments";

export async function GET(req: Request) {
  const guard = await requirePermission("shipments.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const orderId = url.searchParams.get("orderId") ?? undefined;
  let schoolId: string | undefined;
  if (guard.role === "school_admin") {
    if (!guard.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    schoolId = guard.schoolId;
  }
  const rows = await listShipments({ status, orderId, schoolId });
  return NextResponse.json({ shipments: rows });
}

const Body = z.object({
  orderId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        qty: z.number().int().min(1),
      })
    )
    .min(1),
  carrier: z.string().optional(),
  trackingNumber: z.string().optional(),
  shippingAddress: z.record(z.unknown()).optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("shipments.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  try {
    const result = await createShipment({ ...body, createdBy: guard.id });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "shipment failed" },
      { status: 400 }
    );
  }
}
