import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { replayDelivery } from "@/server/erp-bridge";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  // Replaying a delivery re-pushes an order into the ERP. This checked only
  // that the caller was SOME admin, so any of the fourteen staff accounts
  // could fire it — including an Operations Manager who cannot even open the
  // ERP bridge page. Authentication is not authorization.
  const guard = await requirePermission("settings-erp-bridge.write");
  if (isResponse(guard)) return guard;
  const { id } = await ctx.params;
  const deliveryId = Number(id);
  if (!Number.isFinite(deliveryId) || deliveryId <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const r = await replayDelivery(deliveryId);
  return NextResponse.json(r);
}
