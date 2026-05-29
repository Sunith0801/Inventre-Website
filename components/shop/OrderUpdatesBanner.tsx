"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Package, X } from "lucide-react";

type OrderItem = {
  id: string;
  orderNumber: string;
  status: string;
  updatedAt?: string;
  createdAt: string;
};

const STORAGE_KEY = "inv:orderStatusSeen";
const DISMISS_KEY = "inv:orderUpdatesDismissed";

function loadMap(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function saveMap(key: string, m: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(m));
}

/**
 * Surfaces order-status changes on the shop home before the parent goes
 * hunting in /shop/orders. Tracks the last status the user saw for each
 * order in localStorage; when the server reports a different status, the
 * order is "updated". Dismissed updates are remembered separately so the
 * banner doesn't keep nagging for the same change.
 */
export function OrderUpdatesBanner() {
  const [updated, setUpdated] = useState<OrderItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/orders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.orders) return;
        const orders = data.orders as OrderItem[];
        const seen = loadMap(STORAGE_KEY);
        const dismissed = loadMap(DISMISS_KEY);
        const changed = orders.filter((o) => {
          const last = seen[o.id];
          if (!last) {
            // First time we've seen this order. Don't flash a banner for
            // freshly placed orders — only for *changes* to ones we already
            // tracked. Mark and move on.
            seen[o.id] = o.status;
            return false;
          }
          if (last === o.status) return false;
          // Skip if user has already dismissed this exact transition.
          if (dismissed[o.id] === o.status) return false;
          return true;
        });
        saveMap(STORAGE_KEY, seen);
        if (!cancelled) setUpdated(changed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissAll = () => {
    const dismissed = loadMap(DISMISS_KEY);
    for (const o of updated) dismissed[o.id] = o.status;
    saveMap(DISMISS_KEY, dismissed);
    // Mark statuses as seen so they aren't re-surfaced on next mount.
    const seen = loadMap(STORAGE_KEY);
    for (const o of updated) seen[o.id] = o.status;
    saveMap(STORAGE_KEY, seen);
    setUpdated([]);
  };

  if (updated.length === 0) return null;

  const first = updated[0];
  const more = updated.length - 1;

  return (
    <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-4">
      <div className="rounded-2xl border border-brand-200 bg-brand-50/70 px-4 py-3 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-brand border border-brand-100 shrink-0">
          <Package className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-ink-900 truncate">
            Order {first.orderNumber} is now{" "}
            <span className="text-brand-700 uppercase">{first.status}</span>
            {more > 0 ? (
              <span className="font-normal text-ink-600">
                {" "}
                · {more} more {more === 1 ? "update" : "updates"}
              </span>
            ) : null}
          </p>
          <p className="text-[11.5px] text-ink-600 leading-snug">
            Tap to see full tracking and history.
          </p>
        </div>
        <Link
          href="/shop/orders"
          className="inline-flex items-center justify-center rounded-full bg-ink-900 text-white px-3.5 h-8 text-[12px] font-bold hover:bg-brand"
          onClick={dismissAll}
        >
          View orders
        </Link>
        <button
          type="button"
          onClick={dismissAll}
          aria-label="Dismiss"
          className="grid h-7 w-7 place-items-center rounded-full text-ink-500 hover:bg-white hover:text-ink-900"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
