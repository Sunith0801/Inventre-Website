import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices } from "@/db/schema";
import { requirePermission, isResponse } from "@/server/admin-guard";
import { getInvoiceDetail, generateCreditNote } from "@/server/repos/invoices";
import { logAdminActivity } from "@/server/activity";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("invoices.read");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  let scopeSchool: string | undefined;
  if (guard.role === "school_admin") {
    if (!guard.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    scopeSchool = guard.schoolId;
  }
  const detail = await getInvoiceDetail(id, { schoolId: scopeSchool });
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}

const Body = z.object({
  action: z.enum(["cancel", "credit_note"]),
  returnedItems: z
    .array(
      z.object({
        invoiceItemId: z.string().uuid(),
        qty: z.number().int().min(1),
      })
    )
    .optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("invoices.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  if (body.action === "cancel") {
    await db
      .update(invoices)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(invoices.id, id));
    void logAdminActivity(guard, {
      action: "invoice.update",
      entityType: "invoice",
      entityId: id,
      summary: "Cancelled invoice",
      req,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "credit_note") {
    if (!body.returnedItems || body.returnedItems.length === 0) {
      return NextResponse.json(
        { error: "returnedItems required" },
        { status: 400 }
      );
    }
    const result = await generateCreditNote({
      parentInvoiceId: id,
      returnedItems: body.returnedItems,
    });
    void logAdminActivity(guard, {
      action: "invoice.update",
      entityType: "invoice",
      entityId: id,
      summary: `Issued credit note ${result.invoiceNumber}`,
      req,
    });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
