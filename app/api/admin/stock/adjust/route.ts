import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import { adjust, getDefaultWarehouseId } from "@/server/repos/inventory";

const Body = z.object({
  variantId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  delta: z.number().int(), // can be negative
  notes: z.string().min(1),
});

export async function POST(req: Request) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const wh = body.warehouseId ?? (await getDefaultWarehouseId());
  try {
    const result = await adjust(body.variantId, wh, body.delta, body.notes, guard.id);
    void logAdminActivity(guard, {
      action: "stock.adjust",
      entityType: "stock",
      entityId: body.variantId,
      summary: `Adjusted stock ${body.delta >= 0 ? "+" : ""}${body.delta} for variant ${body.variantId} @ warehouse ${wh}: ${body.notes}`,
      req,
    });
    return NextResponse.json({ bin: result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "stock adjustment failed" },
      { status: 400 }
    );
  }
}
