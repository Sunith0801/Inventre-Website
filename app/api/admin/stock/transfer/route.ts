import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import { applyStockChange } from "@/server/repos/inventory";

/**
 * Stock Transfer — move inventory between two warehouses.
 *
 * Single transaction: -delta out of source, +delta into destination, plus
 * paired ledger rows referencing each other via refId.
 */
const Body = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  notes: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        qty: z.number().int().min(1),
      })
    )
    .min(1),
});

export async function POST(req: Request) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  if (body.fromWarehouseId === body.toWarehouseId) {
    return NextResponse.json(
      { error: "Source and destination warehouses must differ" },
      { status: 400 }
    );
  }

  const transferRef = `transfer:${Date.now().toString(16)}`;

  try {
    await db.transaction(async () => {
      for (const line of body.lines) {
        // Out of source
        await applyStockChange({
          variantId: line.variantId,
          warehouseId: body.fromWarehouseId,
          delta: -line.qty,
          reservedDelta: 0,
          reason: "adjustment",
          refType: "transfer_out",
          refId: transferRef,
          notes: body.notes ?? "transfer",
          createdBy: guard.id,
        });
        // Into destination
        await applyStockChange({
          variantId: line.variantId,
          warehouseId: body.toWarehouseId,
          delta: line.qty,
          reservedDelta: 0,
          reason: "adjustment",
          refType: "transfer_in",
          refId: transferRef,
          notes: body.notes ?? "transfer",
          createdBy: guard.id,
        });
      }
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "transfer failed" },
      { status: 400 }
    );
  }

  void logAdminActivity(guard, {
    action: "stock.transfer",
    entityType: "stock",
    entityId: body.fromWarehouseId,
    summary: `Transferred ${body.lines.length} line(s) from warehouse ${body.fromWarehouseId} to ${body.toWarehouseId}`,
    req,
  });

  return NextResponse.json({
    ok: true,
    ref: transferRef,
    transferred: body.lines.length,
  });
}
