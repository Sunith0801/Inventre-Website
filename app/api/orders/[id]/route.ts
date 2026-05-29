import { NextResponse } from "next/server";
import { requireParent, isResponse } from "@/lib/parent-guard";
import {
  getParentOrderDetailFromErp,
  getParentOrderDetailLocal,
} from "@/lib/erp-customer-orders";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const me = await requireParent();
  if (isResponse(me)) return me;
  const decoded = decodeURIComponent(id);
  // ERP mirror is the canonical source once a sync has happened. Fresh
  // shop orders (e.g. just-paid CCAvenue) live only in the local `orders`
  // table until then, so fall back so users can see what they just paid for.
  const order =
    (await getParentOrderDetailFromErp(me.id, decoded)) ??
    (await getParentOrderDetailLocal(me.id, decoded));
  if (!order)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ order });
}
