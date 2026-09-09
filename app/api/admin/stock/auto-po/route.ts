import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";
import { runAutoPo } from "@/lib/auto-po";

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
