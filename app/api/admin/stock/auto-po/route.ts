import { NextResponse } from "next/server";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { runAutoPo } from "@/lib/auto-po";

export async function POST() {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const result = await runAutoPo();
  return NextResponse.json(result);
}
