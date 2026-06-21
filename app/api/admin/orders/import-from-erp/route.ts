/**
 * Admin-triggered import of ERPNext Sales Orders into local `orders`.
 * Mirrors the standalone CLI (scripts/backfill-orders-from-erp.ts) but
 * callable from the admin UI so ops can pull a specific SAL-ORD-NNN
 * or run a bulk catch-up without shelling into the host.
 *
 *   POST /api/admin/orders/import-from-erp
 *   Auth: requireAdmin("super") — the import is heavy-handed (fetches
 *         from ERPNext, writes orders/items/payments) so we restrict
 *         to super; ops can be added later if needed.
 *   Body:
 *     { erpName: "SAL-ORD-2026-27076" }                  // single order
 *   OR  { all: true, limit?: number, since?: "YYYY-MM-DD" }   // bulk
 *
 * Response: { ok: true, ...ImportSummary }
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";
import {
  accumulate,
  emptySummary,
  importSalesOrder,
} from "@/lib/erp-import-orders";
import { erpInboundDisabledResponse } from "@/lib/erp-inbound-guard";

const Body = z.union([
  z.object({
    erpName: z.string().min(1).max(64),
    /** When true, drop + re-import an already-local row (used to pick
     *  up sub-items earlier passes dropped). */
    refresh: z.boolean().optional(),
  }),
  z.object({
    all: z.literal(true),
    limit: z.number().int().min(1).max(2000).optional(),
    since: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "since must be YYYY-MM-DD")
      .optional(),
    refresh: z.boolean().optional(),
  }),
]);

export async function POST(req: Request) {
  const guard = await requirePermission("orders.write");
  if (isResponse(guard)) return guard;
  // ERP import is a global, cross-school operation (no per-school scoping is
  // possible — it pulls whatever ERPNext returns). Restrict to non-school_admin
  // so a school-scoped admin can't pull other schools' orders. Matches the
  // documented super/ops intent.
  if (guard.role === "school_admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const off = erpInboundDisabledResponse();
  if (off) return off;

  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  const summary = emptySummary();

  // Single-order path: smallest possible work unit. The helper itself
  // re-checks the local table, so re-running on the same erpName is
  // safe (returns kind: "skipped", reason: "already_local"). Pass
  // {refresh: true} to drop + re-import.
  if ("erpName" in body) {
    const r = await importSalesOrder(body.erpName, { refresh: body.refresh });
    accumulate(summary, r);
    return NextResponse.json({ ok: true, ...summary });
  }

  // Bulk path: walk the mirror table. Default excludes already-local
  // rows; with {refresh: true} we include them and the helper deletes +
  // re-imports each.
  const limit = body.limit ?? 100;
  const localPredicate = body.refresh
    ? sql``
    : sql`AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_number = m.erp_name)`;
  const result = await db.execute(sql`
    SELECT erp_name
      FROM erp.sales_orders m
     WHERE m.status NOT IN ('Draft', 'Cancelled')
       ${body.since ? sql`AND m.transaction_date >= ${body.since}::date` : sql``}
       ${localPredicate}
     ORDER BY m.transaction_date DESC NULLS LAST, m.erp_name DESC
     LIMIT ${limit}
  `);
  const rows = (Array.isArray(result)
    ? result
    : (result as { rows?: unknown[] }).rows ?? []) as Array<{ erp_name: string }>;

  // Sequential — the admin route is a single short-lived request and we
  // shouldn't hammer ERPNext from a single click. The CLI is the right
  // tool for high-concurrency backfills.
  for (const row of rows) {
    const r = await importSalesOrder(row.erp_name, { refresh: body.refresh });
    accumulate(summary, r);
  }

  return NextResponse.json({ ok: true, ...summary });
}
