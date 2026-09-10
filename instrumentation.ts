/**
 * Next.js instrumentation hook.
 *
 * `onRequestError` fires for every unhandled exception thrown out of a route
 * handler, server component, or RSC. We record it as `api.5xx` into
 * `storefront_events` so the support portal's "Failures (24h)" panel
 * surfaces 500s without per-route wiring.
 *
 * Parent attribution: best-effort. The error context carries the request URL
 * and headers; we lift the parent session cookie and decode it, but never
 * throw from here — telemetry must never break the customer.
 */

import type { Instrumentation } from "next";

export function register() {
  // intentionally empty — we only use onRequestError today
}

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  // Wrap the actual work in a const-foldable check on NEXT_RUNTIME so the
  // Edge bundle (used by middleware) never sees the `postgres`-importing
  // modules. Webpack's parser evaluates the constant condition and strips
  // the dead branch, including the dynamic imports inside it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const [{ recordStorefrontEvent }, { cookieToParentId }] = await Promise.all([
        import("@/server/observability/record-storefront-event"),
        import("@/server/observability/cookie-to-parent-id"),
      ]);

      let parentId: string | null = null;
      const rawCookies =
        (request.headers && (request.headers as Record<string, string>)["cookie"]) ??
        null;
      if (rawCookies) {
        try {
          parentId = await cookieToParentId(rawCookies);
        } catch {
          parentId = null;
        }
      }

      recordStorefrontEvent({
        parentId,
        kind: "api.5xx",
        method: (request as { method?: string }).method ?? null,
        path: request.path ?? null,
        status: 500,
        message: err instanceof Error ? err.message : String(err),
        details: {
          routerKind: context.routerKind,
          routePath: context.routePath ?? null,
          routeType: context.routeType ?? null,
          stack:
            err instanceof Error && err.stack
              ? err.stack.split("\n").slice(0, 6).join("\n")
              : null,
        },
        ip:
          (request.headers as Record<string, string> | undefined)?.[
            "x-forwarded-for"
          ]?.split(",")[0]?.trim() ?? null,
        ua:
          (request.headers as Record<string, string> | undefined)?.[
            "user-agent"
          ] ?? null,
      });
    } catch {
      // never let observability break a real request
    }
  }
};
