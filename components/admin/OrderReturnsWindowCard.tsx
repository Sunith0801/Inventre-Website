"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Save, X } from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";
import {
  RETURNS_WINDOW_DAYS,
  formatWindowDate,
  windowLastDay,
} from "@/lib/exchange-shared";

/**
 * Exchange / Missing request window card (2026-09-26). Shows where this
 * order stands against the 7-day post-delivery rule and lets an admin grant
 * an exception: pick the LAST day on which the parent may still raise an
 * Exchange / Missing request. Saving PATCHes /api/admin/orders/{id}; the
 * storefront (button gate, form pages, submit handlers, My Orders) reads the
 * same column, so the buttons come back for that order at once.
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
    until: string | null;
    note: string | null;
    by: string | null;
    at: string | null;
  };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastDay, setLastDay] = useState(() =>
    override.until ? isoDay(windowLastDay(override.until)) : defaultLastDay(),
  );
  const [note, setNote] = useState(override.note ?? "");

  const now = Date.now();
  const overrideActive =
    !!override.until && new Date(override.until).getTime() > now;
  // Effective = whichever is later: the rule's cut-off or a live override.
  const effectiveExpiresAt =
    standard?.expiresAt && overrideActive
      ? new Date(override.until!).getTime() > new Date(standard.expiresAt).getTime()
        ? override.until!
        : standard.expiresAt
      : standard?.expiresAt ?? null;
  const effectiveExpired = effectiveExpiresAt
    ? new Date(effectiveExpiresAt).getTime() <= now
    : false;
  const extended =
    overrideActive && effectiveExpiresAt === override.until && !effectiveExpired;

  const save = (body: Record<string, unknown>) =>
    start(async () => {
      setError(null);
      const r = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d?.error ?? "Could not save");
        return;
      }
      setEditing(false);
      router.refresh();
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) {
      setError("Pick the last day the parent may raise a request");
      return;
    }
    if (lastDay < isoDay(new Date())) {
      setError("Pick today or a future date");
      return;
    }
    save({ returnsOverrideLastDay: lastDay, returnsOverrideNote: note.trim() || null });
  };

  let status: React.ReactNode;
  if (!standard) {
    status = (
      <p className="text-[13px] text-ink-600">
        Not delivered yet — the window opens once every item has been delivered.
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
        <Badge tone={effectiveExpired ? "default" : "success"} size="md" dot>
          {effectiveExpired ? "Closed" : extended ? "Open (extended)" : "Open"}
        </Badge>
        <span>
          {effectiveExpired
            ? `Closed on ${formatWindowDate(windowLastDay(effectiveExpiresAt!))}`
            : `Requests can be raised until ${formatWindowDate(windowLastDay(effectiveExpiresAt!))}`}
          {!extended && (
            <span className="text-ink-500"> · {RETURNS_WINDOW_DAYS} days from delivery</span>
          )}
        </span>
      </div>
    );
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Exchange / Missing window"
        description="Parents get 7 days after the last delivery. Grant an exception here when the school recommends it."
        className="px-5 pt-5 pb-3"
        actions={
          !editing ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              onClick={() => setEditing(true)}
            >
              {overrideActive ? "Change" : "Enable / extend"}
            </Button>
          ) : null
        }
      />
      <div className="px-5 pb-5 space-y-3">
        {status}
        {overrideActive && (
          <p className="text-[12px] text-ink-500">
            Extended until {formatWindowDate(windowLastDay(override.until!))}
            {override.by ? ` by ${override.by}` : ""}
            {override.at ? ` on ${formatWindowDate(override.at)}` : ""}
            {override.note ? ` — “${override.note}”` : ""}
          </p>
        )}
        {editing && (
          <form onSubmit={submit} className="grid gap-3 rounded-xl border border-ink-100 bg-cream-50/60 p-4">
            <label className="grid gap-1 text-[12px] font-medium text-ink-600">
              Allow Exchange / Missing requests until (last day)
              <input
                type="date"
                className={inputClass}
                value={lastDay}
                min={isoDay(new Date())}
                onChange={(e) => setLastDay(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-[12px] font-medium text-ink-600">
              Reason (optional, shown in the activity log)
              <input
                className={inputClass}
                maxLength={500}
                placeholder="e.g. Principal's recommendation — size issue reported late"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {error && <p className="text-[12.5px] text-rose-600">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" busy={pending} icon={<Save className="h-3.5 w-3.5" />}>
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<X className="h-3.5 w-3.5" />}
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              {overrideActive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-rose-700"
                  disabled={pending}
                  onClick={() => save({ returnsOverrideLastDay: null })}
                >
                  Remove extension
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

function isoDay(d: Date): string {
  // Calendar day in IST.
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function defaultLastDay(): string {
  return isoDay(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";
