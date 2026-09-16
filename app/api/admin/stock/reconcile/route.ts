import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { bins } from "@/db/schema";
import { isResponse, requirePermission, requireAnyPermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import {
  applyStockChange,
  getDefaultWarehouseId,
} from "@/server/repos/inventory";

/**
 * Stock Reconciliation — physical count.
 * Sets actualQty to the absolute value provided by computing the delta vs
 * current bin and dispatching a single applyStockChange with reason=adjustment.
 *
 * Mirrors ERPNext's Stock Reconciliation doctype but keeps the audit ledger
 * intact (one ledger row per recon line, not a wholesale overwrite).
 */
const Body = z.object({
  warehouseId: z.string().uuid().optional(),
  notes: z.string().min(1),
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        countedQty: z.number().int().min(0),
      })
    )
    .min(1),
});

export async function POST(req: Request) {
  const guard = await requireAnyPermission("catalog-stock.write", "catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const wh = body.warehouseId ?? (await getDefaultWarehouseId());

  const results: { variantId: string; delta: number; newQty: number }[] = [];

  try {
    await db.transaction(async (tx) => {
      for (const line of body.lines) {
        const [bin] = await tx
          .select()
          .from(bins)
          .where(
            and(eq(bins.variantId, line.variantId), eq(bins.warehouseId, wh))
          )
          .limit(1);
        const current = bin?.actualQty ?? 0;
        const delta = line.countedQty - current;
        if (delta !== 0) {
          const view = await applyStockChange(
            {
              variantId: line.variantId,
              warehouseId: wh,
              delta,
              reservedDelta: 0,
              reason: "adjustment",
              refType: "reconciliation",
              notes: `physical_count: ${body.notes}`,
              createdBy: guard.id,
            },
            { allowNegative: false }
          );
          results.push({
            variantId: line.variantId,
            delta,
            newQty: view.actualQty,
          });
        } else {
          results.push({
            variantId: line.variantId,
            delta: 0,
            newQty: current,
          });
        }
      }
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reconciliation failed" },
      { status: 400 }
    );
  }

  const changed = results.filter((r) => r.delta !== 0).length;
  void logAdminActivity(guard, {
    action: "stock.reconcile",
    entityType: "stock",
    entityId: wh,
    summary: `Reconciled ${results.length} line(s) @ warehouse ${wh}, ${changed} adjusted: ${body.notes}`,
    req,
  });

  return NextResponse.json({
    ok: true,
    reconciled: results.length,
    results,
  });
}
