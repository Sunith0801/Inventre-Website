import { NextResponse } from "next/server";
import { requireParent, isResponse } from "@/lib/parent-guard";
import {
  listParentOrdersFromErp,
  getParentOrderDetailFromErp,
} from "@/lib/erp-customer-orders";

/**
 * Data for the Parent Help Portal student card (inventre.in/portal):
 * the parent's children (to switch between) + their latest order with
 * carrier/tracking. Parent-gated.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await requireParent();
  if (isResponse(me)) return me;

  const kids = me.students.map((s) => ({
    id: s.id,
    name: s.name,
    enrollmentNumber: s.enrollmentNumber,
    grade: s.schoolGivenGrade ?? s.grade ?? null,
    school: s.school?.name ?? null,
  }));

  // Latest order + carrier/tracking (best-effort — never block the card).
  let latestOrder: {
    orderNumber: string;
    status: string;
    orderedDate: string;
    carrier: string | null;
    tracking: string | null;
    studentName: string | null;
  } | null = null;
  try {
    const orders = await listParentOrdersFromErp(me.id);
    const top = orders[0]; // list is newest-first
    if (top) {
      latestOrder = {
        orderNumber: top.orderNumber,
        status: top.status,
        orderedDate: top.createdAt,
        carrier: null,
        tracking: null,
        studentName: top.studentName,
      };
      const detail = await getParentOrderDetailFromErp(me.id, top.orderNumber);
      const ship =
        detail?.tracking?.find((t) => t.trackingNumber) ?? detail?.tracking?.[0];
      if (ship) {
        latestOrder.carrier = ship.partner ?? null;
        latestOrder.tracking = ship.trackingNumber ?? null;
      }
      if (detail?.status) latestOrder.status = detail.status;
    }
  } catch {
    // best-effort; leave latestOrder as-is
  }

  return NextResponse.json({
    parent: { name: me.name, mobile: me.loggedInPhone ?? me.phone ?? null },
    students: kids,
    latestOrder,
  });
}
