import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { addresses } from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; addressId: string }> }
) {
  const guard = await requirePermission("customers.write");
  if (isResponse(guard)) return guard;
  const { id, addressId } = await params;
  const [before] = await db
    .select()
    .from(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.parentId, id)))
    .limit(1);
  await db
    .delete(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.parentId, id)));
  if (before) {
    void logAdminActivity(guard, {
      action: "customer.address.delete",
      entityType: "customer",
      entityId: id,
      summary: `Deleted address: ${before.receiverName}, ${before.city}`,
      req,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(
  req: Request,
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
  const [updated] = await db
    .select()
    .from(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.parentId, id)))
    .limit(1);
  void logAdminActivity(guard, {
    action: "customer.address.update",
    entityType: "customer",
    entityId: id,
    summary: updated
      ? `Set default address: ${updated.receiverName}, ${updated.city}`
      : "Set default address",
    req,
  });
  return NextResponse.json({ ok: true });
}
