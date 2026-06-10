"use client";

/**
 * "Report missing" button rendered per delivered line item next to
 * "Request exchange". For items the customer never actually received.
 * Visibility logic mirrors ExchangeButton: gated server-side via the
 * `canExchange` flag (same allowlist), hidden when an active claim is
 * already in flight.
 */

import { PackageX } from "lucide-react";

export function MissingButton({
  orderId,
  orderItemId,
  hidden,
}: {
  orderId: string;
  orderItemId: string;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const href = `/shop/orders/${orderId}/missing/new?itemId=${orderItemId}`;
  return (
    <a
      href={href}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1 text-[11.5px] font-semibold text-ink-700 hover:border-rose-500 hover:text-rose-700"
    >
      <PackageX className="h-3 w-3" />
      Report missing
    </a>
  );
}
