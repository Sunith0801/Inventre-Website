import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { hsnCodes } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";
import { eq } from "drizzle-orm";

const Body = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  defaultGstRate: z.number().min(0).max(50).optional(),
  category: z.string().optional(),
});

export async function GET() {
  const guard = await requirePermission("tax.read");
  if (isResponse(guard)) return guard;
  return NextResponse.json({ hsnCodes: await db.select().from(hsnCodes) });
}

export async function POST(req: Request) {
  const guard = await requirePermission("tax.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  await db
    .insert(hsnCodes)
    .values({
      code: body.code,
      description: body.description,
      defaultGstRate:
        body.defaultGstRate != null ? body.defaultGstRate.toString() : null,
      category: body.category ?? null,
    })
    .onConflictDoUpdate({
      target: hsnCodes.code,
      set: {
        description: body.description,
        defaultGstRate:
          body.defaultGstRate != null ? body.defaultGstRate.toString() : null,
        category: body.category ?? null,
      },
    });
  void logAdminActivity(guard, {
    action: "tax_rate.hsn_create",
    entityType: "tax_rate",
    entityId: body.code,
    summary: `Saved HSN code ${body.code}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
