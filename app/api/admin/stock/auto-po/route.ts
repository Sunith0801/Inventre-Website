import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import { runAutoPo } from "@/server/auto-po";

export async function POST(req: Request) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const result = await runAutoPo();
  void logAdminActivity(guard, {
    action: "stock.auto_po",
    entityType: "stock",
    entityId: null,
    summary: "Ran auto-purchase-order generation for low-stock items",
    req,
  });
  return NextResponse.json(result);
}
