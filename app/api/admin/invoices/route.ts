import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { requirePermission, isResponse } from "@/server/admin-guard";
import {
  generateInvoiceForOrder,
  listInvoices,
} from "@/server/repos/invoices";
import { logAdminActivity } from "@/server/activity";

export async function GET(req: Request) {
  const guard = await requirePermission("invoices.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const fy = url.searchParams.get("fy") ?? undefined;
  const parentId = url.searchParams.get("parentId") ?? undefined;
  let schoolId: string | undefined;
  if (guard.role === "school_admin") {
    if (!guard.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    schoolId = guard.schoolId;
  }
  const rows = await listInvoices({ status, fy, parentId, schoolId });
  return NextResponse.json({ invoices: rows });
}

const CreateBody = z.object({
  orderId: z.string().uuid(),
  postingDate: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("invoices.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, CreateBody);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  try {
    const result = await generateInvoiceForOrder({
      orderId: body.orderId,
      postingDate: body.postingDate ? new Date(body.postingDate) : undefined,
    });
    if (!result.alreadyExisted) {
      void logAdminActivity(guard, {
        action: "invoice.create",
        entityType: "order",
        entityId: body.orderId,
        summary: `Created invoice ${result.invoiceNumber}`,
        req,
      });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invoice generation failed" },
      { status: 400 }
    );
  }
}
