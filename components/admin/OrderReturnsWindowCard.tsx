"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, Badge } from "@/components/admin/ui/primitives";
import {
  RETURNS_WINDOW_DAYS,
  formatWindowDate,
  windowLastDay,
} from "@/lib/exchange-shared";

/**
 * Exchange / Missing request window card (2026-09-26). Shows where this
 * order stands against the 7-day post-delivery rule (unchanged) and offers
 * ONE checkbox: "Allow Exchange / Missing requests for this order". Ticked,
 * the storefront buttons come back for this sale order even though the
 * 7 days have passed; unticked, the normal rule applies again. Saving
 * PATCHes /api/admin/orders/{id}; the storefront button gate, form pages,
 * submit handlers and My Orders all read the same column.
 */
export function OrderReturnsWindowCard({
  orderId,
  standard,
  override,
}: {
  orderId: string;
  /** The rule-based window as the storefront computes it. */
  standard: {
    expiresAt: string | null;
    expired: boolean;
    allDelivered: boolean;
  } | null;
  override: {
    enabled: boolean;
    note: string | null;
    by: string | null;
    at: string | null;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(override.note ?? "");

  const effectiveOpen = !standard?.expired || override.enabled;

  const save = (enabled: boolean) =>
    start(async () => {
      setError(null);
      const r = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnsOverrideEnabled: enabled,
          returnsOverrideNote: enabled ? note.trim() || null : null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d?.error ?? "Could not save");
        return;
      }
      router.refresh();
    });

  let status: React.ReactNode;
  if (!standard) {
    status = (
      <p className="text-[13px] text-ink-600">
        Not delivered yet — the {RETURNS_WINDOW_DAYS}-day window starts once every item is delivered.
      </p>
    );
  } else if (!standard.expiresAt) {
    status = (
      <p className="text-[13px] text-ink-600">
        {standard.allDelivered
          ? "Delivered, but a delivery date is missing — requests stay open."
          : "Some items are still on the way — requests stay open until all are delivered."}
      </p>
    );
  } else {
    status = (
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
        <Badge tone={effectiveOpen ? "success" : "default"} size="md" dot>
          {standard.expired ? (override.enabled ? "Open (admin exception)" : "Closed") : "Open"}
        </Badge>
        <span>
          {standard.expired
            ? `${RETURNS_WINDOW_DAYS}-day window closed on ${formatWindowDate(windowLastDay(standard.expiresAt))}`
            : `Requests can be raised until ${formatWindowDate(windowLastDay(standard.expiresAt))}`}
          <span className="text-ink-500"> · {RETURNS_WINDOW_DAYS} days from delivery</span>
        </span>
      </div>
    );
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Exchange / Missing requests"
        description={`Parents get ${RETURNS_WINDOW_DAYS} days after the last delivery. Tick the box to allow requests for this sale order as an exception.`}
        className="px-5 pt-5 pb-3"
      />
      <div className="px-5 pb-5 space-y-3">
        {status}
        <label className="flex items-start gap-3 rounded-xl border border-ink-100 bg-cream-50/60 p-4 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-ink-900"
            checked={override.enabled}
            disabled={pending}
            onChange={(e) => save(e.target.checked)}
          />
          <span className="grid gap-1 min-w-0">
            <span className="text-[13px] font-semibold text-ink-900">
              Allow Exchange / Missing requests for this order
            </span>
            <span className="text-[12px] text-ink-500">
              Shows the Request exchange / Report missing buttons on the parent&apos;s
              storefront even after the {RETURNS_WINDOW_DAYS}-day window. Untick to go back to
              the normal rule.
            </span>
            {override.enabled && (
              <span className="text-[12px] text-ink-500">
                Enabled{override.by ? ` by ${override.by}` : ""}
                {override.at ? ` on ${formatWindowDate(override.at)}` : ""}
                {override.note ? ` — “${override.note}”` : ""}
              </span>
            )}
          </span>
        </label>
        {!override.enabled && (
          <input
            className={inputClass}
            maxLength={500}
            placeholder="Reason (optional, saved with the tick — e.g. Principal's recommendation)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
        {error && <p className="text-[12.5px] text-rose-600">{error}</p>}
      </div>
    </Card>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";
