import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { runAutoPo } from "@/lib/auto-po";

export async function POST() {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const result = await runAutoPo();
  return NextResponse.json(result);
}
