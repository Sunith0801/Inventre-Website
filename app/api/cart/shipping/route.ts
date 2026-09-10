import { NextResponse } from "next/server";
import { getCurrentParent } from "@/server/session";
import { readCart } from "@/server/repos/cart";
import { computeShippingFeePaise } from "@/server/delivery-fee";

/**
 * Preview the shipping fee for the current parent's cart. Same logic used
 * at checkout (lib/delivery-fee.ts) so the cart and gateway totals agree.
 *
 * Uses getCurrentParent (not getCurrentUser): if the same browser also
 * holds an admin cookie, getCurrentUser short-circuits to the admin
 * identity and the route would 0-out the fee even on a real parent visit.
 */
export async function GET() {
  const me = await getCurrentParent();
  if (!me) return NextResponse.json({ shippingPaise: 0 });
  const student = me.students[0];
  if (!student) return NextResponse.json({ shippingPaise: 0 });

  const cart = await readCart(me.id, student.school.id);
  if (cart.lines.length === 0) return NextResponse.json({ shippingPaise: 0 });

  const { shippingPaise, rule } = await computeShippingFeePaise({
    schoolId: student.school.id,
    productIds: cart.lines.filter((l) => l.unitPrice > 0).map((l) => l.productId),
    subtotalPaise: cart.subtotal * 100,
    grade: student.grade,
  });
  return NextResponse.json({
    shippingPaise,
    ruleName: rule?.name ?? null,
    matchedItemGroups: rule?.applicable_item_groups.map((g) => g.item_group) ?? [],
  });
}
