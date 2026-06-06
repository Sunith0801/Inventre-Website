import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, orderItems } from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { isExchangeTester } from "@/lib/exchange-gate";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ExchangeForm } from "@/components/shop/orders/exchange/ExchangeForm";

/**
 * Customer-facing form for raising an exchange request. Server-rendered
 * so the gate (parent session + EXCHANGE_TESTER_PHONES) is enforced
 * before any UI is sent — non-allowlisted parents see a 404 indistinct
 * from a wrong-URL hit.
 *
 * Expects `?itemId=<orderItemId>` so the form can pre-lock the line
 * being exchanged. Without it (or with an itemId that doesn't belong
 * to this parent's order), 404.
 */

export const dynamic = "force-dynamic";

async function resolveLocalOrderId(
  idOrNumber: string,
  parentId: string
): Promise<string | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrNumber);
  if (isUuid) {
    const [row] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.id, idOrNumber), eq(orders.parentId, parentId)))
      .limit(1);
    return row?.status === "delivered" ? row.id : null;
  }
  const [row] = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(eq(orders.orderNumber, idOrNumber), eq(orders.parentId, parentId)))
    .limit(1);
  return row?.status === "delivered" ? row.id : null;
}

export default async function NewExchangePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ itemId?: string }>;
}) {
  const me = await getCurrentParent();
  if (!me) notFound();
  if (!isExchangeTester(me.phone)) notFound();

  const { id } = await params;
  const { itemId } = await searchParams;
  if (!itemId || !/^[0-9a-f-]{36}$/i.test(itemId)) notFound();

  const decoded = decodeURIComponent(id);
  const orderId = await resolveLocalOrderId(decoded, me.id);
  if (!orderId) notFound();

  const [item] = await db
    .select({
      id: orderItems.id,
      name: orderItems.nameSnapshot,
      size: orderItems.size,
      qty: orderItems.qty,
      image: orderItems.imageSnapshot,
      variantId: orderItems.variantId,
    })
    .from(orderItems)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))
    .limit(1);
  if (!item) notFound();
  // ERP-imported items without a local variant can't be exchanged — same
  // guard as createExchange in lib/exchange.ts. Surface as 404 so the
  // route doesn't reveal that the item exists but is ineligible.
  if (!item.variantId) notFound();

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-8 pb-16">
        <a
          href={`/shop/orders/${id}`}
          className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
        >
          ← Back to order
        </a>
        <h1 className="mt-4 font-display text-[28px] font-extrabold text-ink-900">
          Request an exchange
        </h1>
        <p className="mt-1 text-[13px] text-ink-500">
          We&apos;ll review your request and notify you when it&apos;s approved.
        </p>
        <div className="mt-6">
          <ExchangeForm
            orderId={orderId}
            item={{
              orderItemId: item.id,
              name: item.name,
              size: item.size,
              qty: item.qty,
              imageUrl: item.image ?? "",
            }}
          />
        </div>
      </div>
      <Footer />
    </main>
  );
}
