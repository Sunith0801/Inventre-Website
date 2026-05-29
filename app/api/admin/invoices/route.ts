import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import {
  generateInvoiceForOrder,
  listInvoices,
} from "@/lib/repos/invoices";

export async function GET(req: Request) {
  const guard = await requireAdmin("super", "ops", "school_admin");
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
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, CreateBody);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  try {
    const result = await generateInvoiceForOrder({
      orderId: body.orderId,
      postingDate: body.postingDate ? new Date(body.postingDate) : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invoice generation failed" },
      { status: 400 }
    );
  }
}
