import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq, sql } from "drizzle-orm";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";

/**
 * Admin-driven bulk action: archive every product currently marked
 * `erp_is_disabled = true` AND status='active'. The sync only mirrors
 * the ERP flag — it never changes status. This endpoint is how the
 * admin acts on the flag.
 *
 * GET  — preview (counts only). Safe.
 * POST — execute. Sets status='archived' on matching rows.
 *
 * The reverse — re-promote an archived item — is the existing per-product
 * edit page (/admin/products/[id]) where admin sets status back to 'active'.
 */

export async function GET() {
  const guard = await requirePermission("catalog.read");
  if (isResponse(guard)) return guard;
  const [counts] = await db
    .select({
      erpDisabled: sql<number>`COUNT(*) FILTER (WHERE erp_is_disabled = true)::int`,
      erpDisabledActive: sql<number>`COUNT(*) FILTER (WHERE erp_is_disabled = true AND status = 'active')::int`,
      erpDisabledArchived: sql<number>`COUNT(*) FILTER (WHERE erp_is_disabled = true AND status = 'archived')::int`,
      erpDeleted: sql<number>`COUNT(*) FILTER (WHERE erp_is_deleted = true)::int`,
    })
    .from(schema.products);
  return NextResponse.json({
    erpDisabled: counts.erpDisabled,
    erpDisabledActive: counts.erpDisabledActive,
    erpDisabledArchived: counts.erpDisabledArchived,
    erpDeleted: counts.erpDeleted,
  });
}

export async function POST(req: Request) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const result = await db
    .update(schema.products)
    .set({ status: "archived" })
    .where(
      and(
        eq(schema.products.erpIsDisabled, true),
        eq(schema.products.status, "active")
      )
    )
    .returning({ id: schema.products.id });
  // Bust the storefront product list cache so the change is visible.
  // The repo wraps reads in `cached(...)` with a 300s TTL keyed by school.
  try {
    const { redis } = await import("@/lib/redis");
    const keys = await redis.keys("products:school:*");
    if (keys.length > 0) await redis.del(...keys);
  } catch {}

  void logAdminActivity(guard, {
    action: "product.archive_erp_disabled",
    entityType: "product",
    entityId: null,
    summary: `Archived ${result.length} ERP-disabled product(s)`,
    req,
  });

  return NextResponse.json({ archived: result.length });
}
