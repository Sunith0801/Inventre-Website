import { NextResponse } from "next/server";
import { getPaymentCharges } from "@/server/payment-charges";

export const dynamic = "force-dynamic";

/**
 * Public read endpoint for the admin-editable payment-gateway fee
 * schedule. Lives outside /api/checkout/* on purpose — the middleware
 * gates that prefix behind a parent session, but the checkout-fee
 * disclosure needs to be readable before any login (e.g. an admin
 * previewing what shoppers see). Write is at
 * /api/admin/settings/payment-charges (permission-gated).
 */
export async function GET() {
  const config = await getPaymentCharges();
  return NextResponse.json(config);
}
