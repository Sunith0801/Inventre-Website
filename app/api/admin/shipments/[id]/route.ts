import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import {
  getShipmentDetail,
  markShipped,
  markDelivered,
} from "@/lib/repos/shipments";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin("super", "ops", "school_admin");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  let scopeSchool: string | undefined;
  if (guard.role === "school_admin") {
    if (!guard.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    scopeSchool = guard.schoolId;
  }
  const detail = await getShipmentDetail(id, { schoolId: scopeSchool });
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}

const Body = z.object({
  action: z.enum(["mark_shipped", "mark_delivered"]),
  carrier: z.string().optional(),
  trackingNumber: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  try {
    if (body.action === "mark_shipped") {
      if (!body.carrier || !body.trackingNumber) {
        return NextResponse.json(
          { error: "carrier and trackingNumber required" },
          { status: 400 }
        );
      }
      await markShipped(id, body.carrier, body.trackingNumber, guard.id);
    } else if (body.action === "mark_delivered") {
      await markDelivered(id, guard.id);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "shipment update failed" },
      { status: 400 }
    );
  }
}
