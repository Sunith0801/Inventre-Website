"use client";

/**
 * "Request exchange" button rendered per delivered line item. Server is
 * the source of truth on whether it shows at all (the parent API
 * response carries `canExchange:true` only for allowlisted phones on
 * delivered orders). Hides itself when an active exchange already
 * exists — the banner takes over in that case.
 */

import { RefreshCw } from "lucide-react";

export function ExchangeButton({
  orderId,
  orderItemId,
  hidden,
}: {
  orderId: string;
  orderItemId: string;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const href = `/shop/orders/${orderId}/exchange/new?itemId=${orderItemId}`;
  return (
    <a
      href={href}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1 text-[11.5px] font-semibold text-ink-700 hover:border-brand hover:text-brand"
    >
      <RefreshCw className="h-3 w-3" />
      Request exchange
    </a>
  );
}
