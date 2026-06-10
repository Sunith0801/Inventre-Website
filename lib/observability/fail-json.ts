import "server-only";
import { NextResponse } from "next/server";
import {
  recordStorefrontEvent,
  eventKindForStatus,
} from "./record-storefront-event";

/**
 * Replacement for `NextResponse.json({error: …}, {status})` on parent API
 * routes: records the failure into `storefront_events` so it shows up in the
 * support portal's "Failures (24h)" panel, then returns the JSON response.
 *
 * Use whenever a route is about to return 4xx/5xx to a customer where the
 * parent context is already resolved. For unauthenticated 401s skip this
 * helper — we don't have a parent id to attribute the event to.
 */
export function failJson(opts: {
  parentId: string | null;
  studentId?: string | null;
  req: Request;
  status: number;
  message: string;
  /** Optional structured detail to land in storefront_events.details. */
  details?: Record<string, unknown> | null;
  /** Optional: "rule.block" / "otp.throttle" to override the api.* kind. */
  kind?: string;
}): NextResponse {
  const url = (() => {
    try {
      return new URL(opts.req.url);
    } catch {
      return null;
    }
  })();
  recordStorefrontEvent({
    parentId: opts.parentId,
    studentId: opts.studentId ?? null,
    kind: opts.kind ?? eventKindForStatus(opts.status),
    method: opts.req.method,
    path: url?.pathname ?? null,
    status: opts.status,
    message: opts.message,
    details: opts.details ?? null,
    ip:
      opts.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      opts.req.headers.get("x-real-ip") ??
      null,
    ua: opts.req.headers.get("user-agent"),
  });
  return NextResponse.json(
    { error: opts.message, ...(opts.details ?? {}) },
    { status: opts.status },
  );
}
