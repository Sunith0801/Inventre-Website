import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import { parseBody } from "@/server/parse-body";
import { getGroundStockSyncStatus, runGroundStockSync } from "@/server/ground-stock-sync";
import { getGroundStockGate, setGroundStockGate } from "@/server/ground-stock-gate";

/**
 * Ground Stock bridge — admin status, "Sync now", and the availability gate.
 *
 *   GET   → last runs, coverage, current gate
 *   POST  {action:"run"}                          → run a tick now
 *   POST  {action:"gate", enabled, unmatched}     → flip the storefront rule
 */
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function GET() {
  const guard = await requirePermission("catalog.read");
  if (isResponse(guard)) return guard;
  const [status, gate] = await Promise.all([getGroundStockSyncStatus(), getGroundStockGate()]);
  return NextResponse.json({ ...status, gate });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run") }),
  z.object({
    action: z.literal("gate"),
    enabled: z.boolean(),
    unmatched: z.enum(["out_of_stock", "available"]),
  }),
]);

export async function POST(req: Request) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;

  if (parsed.action === "run") {
    const result = await runGroundStockSync("manual");
    void logAdminActivity(guard, {
      action: "stock.ground_sync",
      entityType: "stock",
      entityId: "ground-stock",
      summary: result.ok
        ? `Ground Stock sync: ${result.matched} matched, ${result.changed} changed, ${result.unmatched} unmatched`
        : `Ground Stock sync failed: ${result.error ?? "unknown"}`,
      req,
    });
    return NextResponse.json(result, { status: result.ok || result.skipped ? 200 : 502 });
  }

  const gate = await setGroundStockGate({ enabled: parsed.enabled, unmatched: parsed.unmatched });
  void logAdminActivity(guard, {
    action: "stock.ground_gate",
    entityType: "stock",
    entityId: "ground-stock",
    summary: `Storefront availability gate: ${gate.enabled ? "ON" : "OFF"}, unmatched garments ${gate.unmatched === "available" ? "sell" : "sold out"}`,
    req,
  });
  return NextResponse.json({ ok: true, gate });
}
