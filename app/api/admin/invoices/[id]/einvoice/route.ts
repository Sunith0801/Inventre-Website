import { NextResponse } from "next/server";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { submitIrn } from "@/lib/einvoice";

/**
 * Submit a sales invoice to the NIC IRP and persist the IRN + signed QR.
 * Idempotent in dev (re-stubs); in prod, the IRP rejects duplicates so this
 * effectively becomes a one-shot per invoice.
 */
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("invoices.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  try {
    const result = await submitIrn(id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "IRN submission failed" },
      { status: 400 }
    );
  }
}
