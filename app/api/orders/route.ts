import { NextResponse } from "next/server";
import { requireParent, isResponse } from "@/server/parent-guard";
import { listParentOrdersFromErp } from "@/server/erp-customer-orders";

export async function GET() {
  const me = await requireParent();
  if (isResponse(me)) return me;
  const orders = await listParentOrdersFromErp(me.id);
  return NextResponse.json({ orders });
}
