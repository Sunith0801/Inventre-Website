import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { missingItemClaims, orders } from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { isExchangeTester } from "@/lib/exchange-gate";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import {
  Clock, CheckCircle2, AlertCircle, Package, PackageX, Phone,
} from "lucide-react";
import { firstPickupSaturday } from "@/lib/date";

/**
 * Customer-facing missing-item claim status page. Mirrors the exchange
 * status page but with simpler copy: no return-leg, no decision pair —
 * just "we're processing your claim" → "approved" → "at school for
 * collection" → "completed" or "not approved".
 */

export const dynamic = "force-dynamic";

// CC contact info — shown on every state for the hybrid path.
const CC_PHONE = "+91 9999912345";

const STATUS_COPY: Record<
  string,
  {
    title: string;
    body: (ctx: { pickupLabel: string | null }) => React.ReactNode;
    tone: "amber" | "emerald" | "rose" | "ink";
    Icon: typeof Clock;
  }
> = {
  requested: {
    title: "Claim received",
    body: () =>
      "We've logged your missing-item claim. Customer care will review it and get back to you within 24 hours.",
    tone: "amber",
    Icon: Clock,
  },
  approved: {
    title: "Approved",
    body: ({ pickupLabel }) =>
      `Approved. We're preparing your missing item to send to school. Visit on ${pickupLabel ?? "the scheduled Saturday"} to collect.`,
    tone: "emerald",
    Icon: CheckCircle2,
  },
  received_at_school: {
    title: "Replacement arrived at school",
    body: ({ pickupLabel }) =>
      `Your missing item has arrived at the school. Come ${pickupLabel ? `on ${pickupLabel}` : "during the scheduled pickup window"} to pick it up.`,
    tone: "emerald",
    Icon: Package,
  },
  delivered: {
    title: "Completed",
    body: () =>
      "The school confirmed handover of the missing item. Thank you for letting us know.",
    tone: "ink",
    Icon: CheckCircle2,
  },
  rejected: {
    title: "Not approved",
    body: () =>
      "We weren't able to approve this claim. See the reason below — if you think this is a mistake, please contact customer care.",
    tone: "rose",
    Icon: AlertCircle,
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

function formatPickupLabel(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default async function MissingClaimDetailPage({
  params,
}: {
  params: Promise<{ id: string; claimId: string }>;
}) {
  const me = await getCurrentParent();
  if (!me) notFound();
  if (!isExchangeTester(me.phone)) notFound();

  const { id: orderIdParam, claimId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(claimId)) notFound();

  const [row] = await db
    .select({
      cl: missingItemClaims,
      order: orders,
    })
    .from(missingItemClaims)
    .innerJoin(orders, eq(orders.id, missingItemClaims.orderId))
    .where(and(eq(missingItemClaims.id, claimId), eq(missingItemClaims.parentId, me.id)))
    .limit(1);
  if (!row) notFound();

  // Promote 'approved' → 'received_at_school' pseudo-state once the
  // replacementArrivedAt timestamp is set (same UI pattern as the
  // exchange flow).
  const baseStatus = row.cl.status;
  const status =
    baseStatus === "approved" && row.cl.replacementArrivedAt
      ? "received_at_school"
      : baseStatus;
  const copy = STATUS_COPY[status] ?? STATUS_COPY.requested;
  const pickupLabel = row.cl.pickupDate ? formatPickupLabel(row.cl.pickupDate) : null;
  const Icon = copy.Icon;
  const tone = copy.tone;

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
          <p className="text-[12px] font-semibold tracking-[0.18em] uppercase text-rose-600">
            Missing item
          </p>
          <h1 className="mt-1 font-display text-[28px] font-extrabold text-ink-900">
            {row.cl.claimNumber ?? "Claim"}
          </h1>
          <p className="mt-1 text-[12px] text-ink-500">
            Submitted{" "}
            {new Date(row.cl.createdAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>

        <div className={"mt-6 flex items-start gap-3 rounded-2xl border p-4 " + TONE[tone]}>
          <Icon className={"h-5 w-5 mt-0.5 shrink-0 " + TONE_ICON[tone]} />
          <div className="text-[13px]">
            <p className={"font-display text-[14px] font-bold " + TONE_TITLE[tone]}>
              {copy.title}
            </p>
            <p className={"mt-0.5 " + TONE_BODY[tone]}>{copy.body({ pickupLabel })}</p>
          </div>
        </div>

        {status === "rejected" && row.cl.rejectionReason && (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/50 p-4 text-[13px]">
            <p className="font-display text-[13px] font-bold text-rose-900">
              Reason from our team
            </p>
            <p className="mt-1 text-rose-900 whitespace-pre-line italic">
              &ldquo;{row.cl.rejectionReason}&rdquo;
            </p>
          </div>
        )}

        {/* Hybrid path: always-visible CC contact card. */}
        <div className="mt-4 rounded-2xl border border-ink-200 bg-white p-4 text-[13px]">
          <p className="font-semibold text-ink-900 flex items-center gap-2">
            <Phone className="w-4 h-4 text-ink-500" /> Customer care
          </p>
          <p className="mt-1 text-ink-700">
            For urgent help with this claim, call <strong>{CC_PHONE}</strong>.
          </p>
        </div>

        {/* Notes */}
        {row.cl.notes && (
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white p-4 text-[13px]">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              What you told us
            </p>
            <p className="mt-1.5 text-ink-800 whitespace-pre-line">{row.cl.notes}</p>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
