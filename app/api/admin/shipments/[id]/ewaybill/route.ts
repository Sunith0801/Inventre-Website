import { NextResponse } from "next/server";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { submitEWB } from "@/lib/ewaybill";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("shipments.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  try {
    const result = await submitEWB(id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "EWB submission failed" },
      { status: 400 }
    );
  }
}
