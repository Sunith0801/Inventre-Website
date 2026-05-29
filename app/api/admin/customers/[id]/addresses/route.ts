import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { addresses, students } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

const Body = z.object({
  label: z.string().nullable().optional(),
  receiverName: z.string().min(1),
  receiverPhone: z.string().regex(/^\d{10}$/, "10-digit phone required"),
  line1: z.string().min(1),
  line2: z.string().nullable().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().regex(/^\d{6}$/, "6-digit pincode required"),
  addressType: z.enum(["shipping", "billing"]).default("shipping"),
  gstin: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin("super", "ops", "school_admin");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  if (guard.role === "school_admin") {
    if (!guard.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const [match] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.parentId, id), eq(students.schoolId, guard.schoolId)))
      .limit(1);
    if (!match)
      return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(addresses)
    .where(eq(addresses.parentId, id))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
  return NextResponse.json({ addresses: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  if (body.isDefault) {
    await db
      .update(addresses)
      .set({ isDefault: false })
      .where(eq(addresses.parentId, id));
  }

  const [created] = await db
    .insert(addresses)
    .values({
      parentId: id,
      label: body.label ?? null,
      receiverName: body.receiverName,
      receiverPhone: body.receiverPhone,
      line1: body.line1,
      line2: body.line2 ?? null,
      city: body.city,
      state: body.state,
      pincode: body.pincode,
      addressType: body.addressType,
      gstin: body.gstin ?? null,
      isDefault: body.isDefault ?? false,
    })
    .returning();
  return NextResponse.json({ address: created });
}
