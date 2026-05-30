import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { addresses } from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; addressId: string }> }
) {
  const guard = await requirePermission("customers.write");
  if (isResponse(guard)) return guard;
  const { id, addressId } = await params;
  await db
    .delete(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.parentId, id)));
  return NextResponse.json({ ok: true });
}

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string; addressId: string }> }
) {
  // Set as default
  const guard = await requirePermission("customers.write");
  if (isResponse(guard)) return guard;
  const { id, addressId } = await params;
  await db
    .update(addresses)
    .set({ isDefault: false })
    .where(eq(addresses.parentId, id));
  await db
    .update(addresses)
    .set({ isDefault: true })
    .where(and(eq(addresses.id, addressId), eq(addresses.parentId, id)));
  return NextResponse.json({ ok: true });
}
