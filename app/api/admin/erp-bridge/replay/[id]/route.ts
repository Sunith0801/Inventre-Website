import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/session";
import { replayDelivery } from "@/server/erp-bridge";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  if (me?.kind !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const deliveryId = Number(id);
  if (!Number.isFinite(deliveryId) || deliveryId <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const r = await replayDelivery(deliveryId);
  return NextResponse.json(r);
}
