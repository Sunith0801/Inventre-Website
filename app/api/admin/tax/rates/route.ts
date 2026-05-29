import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { taxRates } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { eq } from "drizzle-orm";

const Body = z.object({
  name: z.string().min(1),
  cgstRate: z.number().min(0).max(50).default(0),
  sgstRate: z.number().min(0).max(50).default(0),
  igstRate: z.number().min(0).max(50).default(0),
  cessRate: z.number().min(0).max(50).default(0),
  hsnPattern: z.string().nullable().optional(),
  isDefault: z.boolean().default(false),
});

export async function GET() {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  return NextResponse.json({ rates: await db.select().from(taxRates) });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  if (body.isDefault) {
    await db
      .update(taxRates)
      .set({ isDefault: false })
      .where(eq(taxRates.isDefault, true));
  }
  const [created] = await db
    .insert(taxRates)
    .values({
      name: body.name,
      cgstRate: body.cgstRate.toString(),
      sgstRate: body.sgstRate.toString(),
      igstRate: body.igstRate.toString(),
      cessRate: body.cessRate.toString(),
      hsnPattern: body.hsnPattern ?? null,
      isDefault: body.isDefault,
    })
    .returning();
  return NextResponse.json({ rate: created });
}
