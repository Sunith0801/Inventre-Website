import { NextResponse } from "next/server";
import { requirePermission, isResponse } from "@/server/admin-guard";
import { listShipments } from "@/server/repos/shipments";

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
