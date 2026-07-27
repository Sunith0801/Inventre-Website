import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getParentOrderDetailFromErp } from "@/lib/erp-customer-orders";
import { db } from "@/db/client";
import { returns, returnItems, orderItems, orders, schools } from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { isExchangeTester } from "@/lib/exchange-gate";
import {
  formatPickupLabel,
  isCancelledReason,
  stripCancelledPrefix,
  isCancellableRequestStatus,
} from "@/lib/exchange";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Clock, CheckCircle2, AlertCircle, Package, XCircle } from "lucide-react";
import { resolveDuplicateOf } from "@/lib/return-duplicates";
import { DuplicateOfNote } from "@/components/shop/orders/DuplicateOfNote";
import { CancelRequestButton } from "@/components/shop/orders/CancelRequestButton";

/**
 * Status detail for a single exchange request. Server-rendered behind
 * the same parent-session + EXCHANGE_TESTER_PHONES gate as the form.
 * Mirrors the banner copy so the parent can come back any time and see
 * the same story.
 */

export const dynamic = "force-dynamic";

// Schools whose exchange/missing collection happens at the Inventre store,
// not at the school office. For these, the banner copy says "the store"
// instead of "your school".
const STORE_PICKUP_SCHOOL_CODES = new Set(["KLINK", "QLPHP"]);

const STATUS_COPY: Record<
  string,
  {
    title: string;
    body: (args: {
      pickupLabel: string | null;
      reason?: string | null;
      atStore?: boolean;
    }) => React.ReactNode;
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
    body: ({ pickupLabel, atStore }) =>
      atStore ? (
        <>
          Visit the{" "}
          <span className="font-semibold">
            Inventre Experience Store, Ashoka Mall, Kukatpally
          </span>{" "}
          on {pickupLabel ?? "the scheduled day"} to collect the exchange. Please
          show this order at the store to confirm.
        </>
      ) : (
        `Visit your school on ${pickupLabel ?? "the scheduled Saturday"} to collect the exchange. Please show this order to the school office to confirm.`
      ),
    tone: "emerald",
    Icon: CheckCircle2,
  },
  replacement_arrived: {
    title: "Replacement arrived at school",
    body: ({ pickupLabel, atStore }) =>
      atStore ? (
        <>
          Your replacement has arrived at the{" "}
          <span className="font-semibold">
            Inventre Experience Store, Ashoka Mall, Kukatpally
          </span>
          . Come{" "}
          {pickupLabel ? `on ${pickupLabel}` : "during the scheduled pickup window"}{" "}
          with the original item to complete the exchange.
        </>
      ) : (
        `Your replacement has arrived at the school. Come ${pickupLabel ? `on ${pickupLabel}` : "during the scheduled pickup window"} with the original item to complete the exchange.`
      ),
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
  cancelled: {
    title: "Cancelled",
    body: () =>
      "You cancelled this request, so the replacement won't be sent. You can raise a new request any time if you still need one.",
    tone: "ink",
    Icon: XCircle,
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
      schoolCode: schools.schoolCode,
    })
    .from(returns)
    .innerJoin(orders, eq(orders.id, returns.orderId))
    .innerJoin(schools, eq(schools.id, orders.schoolId))
    .where(eq(returns.id, returnId))
    .limit(1);
  if (!row) notFound();
  if (row.ret.kind !== "exchange") notFound();
  // FAMILY-IDENTITY AUTHORIZATION (2026-07-27) — replaces the strict
  // `parent_id === me.id` match that used to sit in the WHERE above. That
  // match 404'd this page for any family member whose own `parents` row isn't
  // the one on the request: split accounts, co-guardians, and EVERY
  // care-team-raised request (those carry the ORDER's parent_id, not the
  // reporter's). Measured on prod: ~27% of exchanges / ~21% of claims had at
  // least one such family member. Every other path — My Orders, order detail,
  // the pickers, the submit handlers — dropped this match long ago (see
  // isExchangeOwnershipRelaxed); these two status pages were the last
  // holdouts. getParentOrderDetailFromErp applies the SAME family scope as
  // My Orders and returns null for anyone outside the family, so the security
  // boundary is unchanged — this only widens access to orders the parent can
  // already see.
  if (!(await getParentOrderDetailFromErp(me.id, row.order.orderNumber))) notFound();

  const atStore = STORE_PICKUP_SCHOOL_CODES.has(row.schoolCode ?? "");

  const lineRows = await db
    .select({
      ri: returnItems,
      oi: orderItems,
    })
    .from(returnItems)
    .innerJoin(orderItems, eq(orderItems.id, returnItems.orderItemId))
    .where(eq(returnItems.returnId, returnId));

  // Promote `approved` to the new `replacement_arrived` pseudo-state when
  // the audit-side webhook has stamped the arrival timestamp. The
  // underlying status stays `approved` in DB — this is a UI-only sub-state.
  const baseStatus = row.ret.status as keyof typeof STATUS_COPY;
  // A "rejected" row whose reason begins "Cancelled — " is a customer/staff
  // cancellation, not a decline — render it as its own "Cancelled" state
  // (see lib/exchange-shared.ts §"Customer self-cancellation").
  const isCancelled =
    baseStatus === "rejected" && isCancelledReason(row.ret.rejectionReason);
  const status: keyof typeof STATUS_COPY = isCancelled
    ? "cancelled"
    : baseStatus === "approved" && row.ret.replacementArrivedAt
      ? "replacement_arrived"
      : baseStatus;
  // Cancellable while still early (requested / approved and not yet dispatched
  // to school). The ERP is the final authority; this only decides whether to
  // show the button.
  const canCancel = isCancellableRequestStatus(
    baseStatus,
    !!row.ret.replacementArrivedAt,
  );
  const cancelReason = isCancelled
    ? stripCancelledPrefix(row.ret.rejectionReason)
    : null;
  const copy = STATUS_COPY[status] ?? STATUS_COPY.requested;
  const pickupLabel = row.ret.pickupDate ? formatPickupLabel(row.ret.pickupDate) : null;
  const Icon = copy.Icon;
  const tone = copy.tone;
  const title =
    atStore && status === "replacement_arrived"
      ? "Replacement arrived at store"
      : copy.title;

  const photos: { url: string; key: string }[] = Array.isArray(row.ret.photos)
    ? (row.ret.photos as { url: string; key: string }[])
    : [];

  // When the rejection was a duplicate, resolve the other RTN(s): prefer
  // the structured `duplicate_of` (new rejections), fall back to RTNs
  // scraped from the reason text (older rejections predating the column).
  const dups =
    status === "rejected"
      ? resolveDuplicateOf(
          row.ret.duplicateOf,
          row.ret.rejectionReason,
          row.ret.returnNumber
        )
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
              {title}
            </p>
            <p className={"mt-0.5 " + TONE_BODY[tone]}>
              {copy.body({ pickupLabel, reason: row.ret.reason, atStore })}
            </p>
          </div>
        </div>

        {/* Self-cancel — only while the request is still early (approval
            pending / approved but not yet dispatched to school). */}
        {canCancel && (
          <div className="mt-3">
            <CancelRequestButton
              kind="exchange"
              orderId={orderIdParam}
              requestId={row.ret.id}
            />
          </div>
        )}

        {/* Cancelled: show the customer's own reason plainly (not the rose
            "reason from our team" box, which is for genuine declines). */}
        {isCancelled && cancelReason && (
          <div className="mt-3 rounded-2xl border border-ink-200 bg-cream-50/60 p-4 text-[13px]">
            <p className="font-display text-[13px] font-bold text-ink-800">
              Your cancellation reason
            </p>
            <p className="mt-1 text-ink-700 whitespace-pre-line italic">
              &ldquo;{cancelReason}&rdquo;
            </p>
          </div>
        )}

        {/* When rejected and customer-care left a specific reason, surface
            it verbatim. Previously the customer just saw the generic
            "contact support" line above and had no idea why. */}
        {status === "rejected" && (row.ret.rejectionReason || dups.length > 0) && (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/50 p-4 text-[13px]">
            <p className="font-display text-[13px] font-bold text-rose-900">
              Reason from our team
            </p>
            {row.ret.rejectionReason && (
              <p className="mt-1 text-rose-900 whitespace-pre-line italic">
                &ldquo;{row.ret.rejectionReason}&rdquo;
              </p>
            )}
            <DuplicateOfNote dups={dups} />
          </div>
        )}

        {/* Request details */}
        <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5">
          <h3 className="font-display text-[14px] font-bold text-ink-900">
            Items
          </h3>
          <ul className="mt-3 space-y-2">
            {lineRows.map(({ ri, oi }) => {
              // When the customer flagged a specific component inside a kit
              // (Magic Box / Bookkit), surface that component as the real
              // subject of the exchange — the order_item row alone reads
              // as just "SAS KS GRADE 6 MAGIC BOX BOYS · Standard" and
              // hides what the customer actually pointed at. The path lives
              // PER return_item (each flagged component is its own row), so
              // read it off `ri` — NOT the parent `returns` row, whose single
              // path would mislabel every line with the first component's name
              // (e.g. 9 different magic-box parts all shown as "Bloomers").
              const path =
                ri.requestedComponentPath &&
                typeof ri.requestedComponentPath === "object"
                  ? (ri.requestedComponentPath as {
                      variantId?: string;
                      componentName?: string | null;
                      attributes?: { name?: string; value?: string }[];
                    })
                  : null;
              const componentName =
                path && typeof path.componentName === "string"
                  ? path.componentName
                  : null;
              const componentDetail = (() => {
                const attrs = Array.isArray(path?.attributes) ? path!.attributes : [];
                const parts = attrs
                  .map((a) => (typeof a?.value === "string" ? a.value : null))
                  .filter((v): v is string => !!v);
                return parts.join(" · ");
              })();
              return (
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
                    {componentName ? (
                      <>
                        <p className="font-medium text-ink-900 truncate">
                          {componentName}
                        </p>
                        <p className="text-[12px] text-ink-500 truncate">
                          {componentDetail || "—"}
                          <span className="text-ink-400">
                            {" "}· in {oi.nameSnapshot}
                          </span>
                          {" · × "}
                          {ri.qty}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-ink-900 truncate">
                          {oi.nameSnapshot}
                        </p>
                        <p className="text-[12px] text-ink-500">
                          {oi.size ? `Size ${oi.size} · ` : ""}× {ri.qty}
                        </p>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
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
