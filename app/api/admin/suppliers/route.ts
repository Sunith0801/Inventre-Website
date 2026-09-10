import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { suppliers } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import { listSuppliers, nextSupplierCode } from "@/server/repos/suppliers";

export async function GET(req: Request) {
  const guard = await requirePermission("suppliers.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  return NextResponse.json({ suppliers: await listSuppliers(q) });
}

const Body = z.object({
  name: z.string().min(1),
  contactName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  gstin: z.string().nullable().optional(),
  pan: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  address: z.record(z.unknown()).nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("suppliers.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const supplierCode = await nextSupplierCode();
  const [created] = await db
    .insert(suppliers)
    .values({
      supplierCode,
      name: body.name,
      contactName: body.contactName ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      gstin: body.gstin ?? null,
      pan: body.pan ?? null,
      paymentTerms: body.paymentTerms ?? null,
      notes: body.notes ?? null,
      address: body.address ?? null,
    })
    .returning();
  void logAdminActivity(guard, {
    action: "supplier.create",
    entityType: "supplier",
    entityId: created.id,
    summary: `Created supplier ${created.name} (${supplierCode})`,
    req,
  });
  return NextResponse.json({ id: created.id, supplierCode });
}
