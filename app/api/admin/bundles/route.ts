import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import {
  productBundles,
  bundleSelectors,
  bundleComponents,
  bundleConfigs,
  products,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";

export async function GET() {
  const guard = await requirePermission("catalog.read");
  if (isResponse(guard)) return guard;
  const rows = await db
    .select({
      bundle: productBundles,
      product: products,
    })
    .from(productBundles)
    .innerJoin(products, eq(products.id, productBundles.productId))
    .orderBy(desc(productBundles.createdAt));
  return NextResponse.json({ bundles: rows });
}

const CreateBody = z.object({
  productId: z.string().uuid(),
  bundleType: z.enum(["fixed", "configurable"]),
  pricingMode: z.enum(["sum", "fixed"]).default("sum"),
  fixedPrice: z.number().int().min(0).nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, CreateBody);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const [created] = await db
    .insert(productBundles)
    .values({
      productId: body.productId,
      bundleType: body.bundleType,
      pricingMode: body.pricingMode,
      fixedPrice: body.fixedPrice ?? null,
    })
    .returning();

  void logAdminActivity(guard, {
    action: "bundle.create",
    entityType: "bundle",
    entityId: created.id,
    summary: `Created ${created.bundleType} bundle`,
    req,
  });

  return NextResponse.json({ bundle: created });
}
