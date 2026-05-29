import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { addresses } from "@/db/schema";
import { requireParent, isResponse } from "@/lib/parent-guard";

export async function GET() {
  const me = await requireParent();
  if (isResponse(me)) return me;
  const rows = await db
    .select()
    .from(addresses)
    .where(eq(addresses.parentId, me.id))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
  return NextResponse.json({ addresses: rows });
}

const Body = z.object({
  label: z.string().nullable().optional(),
  receiverName: z.string().min(1),
  receiverPhone: z.string().regex(/^\d{10}$/),
  line1: z.string().min(1),
  line2: z.string().nullable().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().regex(/^\d{6}$/),
  isDefault: z.boolean().optional(),
});

export async function POST(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;

  const body = Body.parse(await req.json());

  if (body.isDefault) {
    await db
      .update(addresses)
      .set({ isDefault: false })
      .where(eq(addresses.parentId, me.id));
  }

  const [created] = await db
    .insert(addresses)
    .values({
      parentId: me.id,
      label: body.label ?? null,
      receiverName: body.receiverName,
      receiverPhone: body.receiverPhone,
      line1: body.line1,
      line2: body.line2 ?? null,
      city: body.city,
      state: body.state,
      pincode: body.pincode,
      isDefault: body.isDefault ?? false,
    })
    .returning();
  return NextResponse.json({ address: created });
}
