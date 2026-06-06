import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { returns, returnItems, orderItems, orders } from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { isExchangeTester } from "@/lib/exchange-gate";
import { formatPickupLabel } from "@/lib/exchange";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Clock, CheckCircle2, AlertCircle, Package } from "lucide-react";

/**
 * Status detail for a single exchange request. Server-rendered behind
 * the same parent-session + EXCHANGE_TESTER_PHONES gate as the form.
 * Mirrors the banner copy so the parent can come back any time and see
 * the same story.
 */

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<
  string,
  {
    title: string;
    body: (args: { pickupLabel: string | null; reason?: string | null }) => string;
    tone: "amber" | "emerald" | "rose" | "ink";
    Icon: typeof Clock;
  }
> = {
  requested: {
    title: "Approval pending",
    body: () =>
      "Our customer-care team is reviewing your request. You'll get an SMS as soon as it's approved.",
    tone: "amber",
    Icon: Clock,
  },
  approved: {
    title: "Approved",
    body: ({ pickupLabel }) =>
      `Visit your school on ${pickupLabel ?? "the scheduled Saturday"} to collect the exchange. Please show this order to the school office to confirm.`,
    tone: "emerald",
    Icon: CheckCircle2,
  },
  rejected: {
    title: "Not approved",
    body: () =>
      "We weren't able to approve this exchange. If you think this is a mistake, please contact our support team.",
    tone: "rose",
    Icon: AlertCircle,
  },
  received: {
    title: "Exchange completed",
    body: () =>
      "The school confirmed handover of the exchange item. Thank you for shopping with Inventre.",
    tone: "ink",
    Icon: Package,
  },
};

const TONE: Record<"amber" | "emerald" | "rose" | "ink", string> = {
  amber: "border-amber-200 bg-amber-50",
  emerald: "border-emerald-200 bg-emerald-50",
  rose: "border-rose-200 bg-rose-50",
  ink: "border-ink-200 bg-cream-100",
};

const TONE_TITLE: Record<"amber" | "emerald" | "rose" | "ink", string> = {
  amber: "text-amber-900",
  emerald: "text-emerald-900",
  rose: "text-rose-900",
  ink: "text-ink-900",
};

const TONE_BODY: Record<"amber" | "emerald" | "rose" | "ink", string> = {
  amber: "text-amber-800",
  emerald: "text-emerald-800",
  rose: "text-rose-800",
  ink: "text-ink-600",
};

const TONE_ICON: Record<"amber" | "emerald" | "rose" | "ink", string> = {
  amber: "text-amber-500",
  emerald: "text-emerald-500",
  rose: "text-rose-500",
  ink: "text-ink-500",
};

export default async function ExchangeDetailPage({
  params,
}: {
  params: Promise<{ id: string; returnId: string }>;
}) {
  const me = await getCurrentParent();
  if (!me) notFound();
  if (!isExchangeTester(me.phone)) notFound();

  const { id: orderIdParam, returnId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(returnId)) notFound();

  const [row] = await db
    .select({
      ret: returns,
      order: orders,
    })
    .from(returns)
    .innerJoin(orders, eq(orders.id, returns.orderId))
    .where(and(eq(returns.id, returnId), eq(returns.parentId, me.id)))
    .limit(1);
  if (!row) notFound();
  if (row.ret.kind !== "exchange") notFound();

  const lineRows = await db
    .select({
      ri: returnItems,
      oi: orderItems,
    })
    .from(returnItems)
    .innerJoin(orderItems, eq(orderItems.id, returnItems.orderItemId))
    .where(eq(returnItems.returnId, returnId));

  const status = row.ret.status as keyof typeof STATUS_COPY;
  const copy = STATUS_COPY[status] ?? STATUS_COPY.requested;
  const pickupLabel = row.ret.pickupDate ? formatPickupLabel(row.ret.pickupDate) : null;
  const Icon = copy.Icon;
  const tone = copy.tone;

  const photos: { url: string; key: string }[] = Array.isArray(row.ret.photos)
    ? (row.ret.photos as { url: string; key: string }[])
    : [];

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-8 pb-16">
        <a
          href={`/shop/orders/${orderIdParam}`}
          className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
        >
          ← Back to order
        </a>

        <div className="mt-4">
          <p className="text-[12px] font-semibold tracking-[0.18em] uppercase text-brand">
            Exchange
          </p>
          <h1 className="mt-1 font-display text-[28px] font-extrabold text-ink-900">
            {row.ret.returnNumber ?? "Request"}
          </h1>
          <p className="mt-1 text-[12px] text-ink-500">
            Submitted{" "}
            {new Date(row.ret.createdAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>

        <div
          className={
            "mt-6 flex items-start gap-3 rounded-2xl border p-4 " + TONE[tone]
          }
        >
          <Icon className={"h-5 w-5 mt-0.5 shrink-0 " + TONE_ICON[tone]} />
          <div className="text-[13px]">
            <p className={"font-display text-[14px] font-bold " + TONE_TITLE[tone]}>
              {copy.title}
            </p>
            <p className={"mt-0.5 " + TONE_BODY[tone]}>
              {copy.body({ pickupLabel, reason: row.ret.reason })}
            </p>
          </div>
        </div>

        {/* Request details */}
        <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5">
          <h3 className="font-display text-[14px] font-bold text-ink-900">
            Items
          </h3>
          <ul className="mt-3 space-y-2">
            {lineRows.map(({ ri, oi }) => (
              <li key={ri.id} className="flex items-center gap-3 text-[13px]">
                <div className="h-12 w-12 shrink-0 rounded-lg bg-cream-100 border border-ink-100 overflow-hidden">
                  {oi.imageSnapshot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={oi.imageSnapshot}
                      alt=""
                      className="h-full w-full object-contain p-1"
                    />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-ink-900 truncate">
                    {oi.nameSnapshot}
                  </p>
                  <p className="text-[12px] text-ink-500">
                    {oi.size ? `Size ${oi.size} · ` : ""}× {ri.qty}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 pt-4 border-t border-ink-100 text-[13px]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
              Reason
            </p>
            <p className="mt-1 text-ink-800">{row.ret.reason ?? "—"}</p>
            {row.ret.notes && (
              <>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Notes
                </p>
                <p className="mt-1 text-ink-800 whitespace-pre-line">
                  {row.ret.notes}
                </p>
              </>
            )}
          </div>

          {photos.length > 0 && (
            <div className="mt-4 pt-4 border-t border-ink-100">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Photos
              </p>
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                {photos.map((p) => (
                  <a
                    key={p.key}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="aspect-square rounded-lg border border-ink-100 bg-cream-50 overflow-hidden"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </main>
  );
}
