import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { warehouses } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import { eq } from "drizzle-orm";

const Body = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  address: z.record(z.unknown()).optional(),
  isDefault: z.boolean().default(false),
});

export async function GET() {
  const guard = await requirePermission("catalog.read");
  if (isResponse(guard)) return guard;
  return NextResponse.json({ warehouses: await db.select().from(warehouses) });
}

export async function POST(req: Request) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  if (body.isDefault) {
    await db
      .update(warehouses)
      .set({ isDefault: false })
      .where(eq(warehouses.isDefault, true));
  }
  const [created] = await db.insert(warehouses).values(body).returning();
  void logAdminActivity(guard, {
    action: "warehouse.create",
    entityType: "warehouse",
    entityId: created.id,
    summary: `Created warehouse ${created.name} (${created.code})`,
    req,
  });
  return NextResponse.json({ warehouse: created });
}
