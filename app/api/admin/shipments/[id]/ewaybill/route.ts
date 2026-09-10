import { NextResponse } from "next/server";
import { requirePermission, isResponse } from "@/server/admin-guard";
import { submitEWB } from "@/server/ewaybill";
import { logAdminActivity } from "@/server/activity";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("shipments.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  try {
    const result = await submitEWB(id);
    void logAdminActivity(guard, {
      action: "shipment.ewaybill",
      entityType: "shipment",
      entityId: id,
      summary: "Submitted e-way bill",
      req,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "EWB submission failed" },
      { status: 400 }
    );
  }
}
