import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { priceLists } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import { eq } from "drizzle-orm";

const Body = z.object({
  name: z.string().min(1),
  currency: z.string().default("INR"),
  appliesTo: z.enum(["selling", "buying", "both"]).default("selling"),
  isDefault: z.boolean().default(false),
  description: z.string().optional(),
});

export async function GET() {
  const guard = await requirePermission("catalog.read");
  if (isResponse(guard)) return guard;
  return NextResponse.json({ priceLists: await db.select().from(priceLists) });
}

export async function POST(req: Request) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  // If isDefault=true, unset other defaults first
  if (body.isDefault) {
    await db
      .update(priceLists)
      .set({ isDefault: false })
      .where(eq(priceLists.isDefault, true));
  }
  const [created] = await db.insert(priceLists).values(body).returning();

  void logAdminActivity(guard, {
    action: "price_list.create",
    entityType: "price_list",
    entityId: created.id,
    summary: `Created price list ${created.name}`,
    req,
  });

  return NextResponse.json({ priceList: created });
}
