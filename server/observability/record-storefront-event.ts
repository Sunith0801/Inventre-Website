import "server-only";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";

/**
 * Append-only telemetry the support portal reads under "Failures (24h)".
 *
 * Fire-and-forget. Never throw from this helper — observability must never
 * break a real customer's request.
 */
export type StorefrontEventInput = {
  parentId?: string | null;
  studentId?: string | null;
  /** Canonical kind: "api.4xx" | "api.5xx" | "rule.block" | "otp.throttle" */
  kind: string;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  message?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
  ua?: string | null;
};

export function recordStorefrontEvent(input: StorefrontEventInput): void {
  // Schedule the insert without blocking the response.
  void (async () => {
    try {
      await db.execute(sql`
        INSERT INTO storefront_events (
          parent_id, student_id, kind, method, path, status,
          message, details, ip, ua
        ) VALUES (
          ${input.parentId ?? null},
          ${input.studentId ?? null},
          ${input.kind},
          ${input.method ?? null},
          ${input.path ?? null},
          ${input.status ?? null},
          ${input.message ?? null},
          ${input.details ? JSON.stringify(input.details) : null}::jsonb,
          ${input.ip ?? null},
          ${input.ua ?? null}
        )
      `);
    } catch {
      // swallow — never surface telemetry errors to the customer
    }
  })();
}

/** Extract a parent id from server context if the caller didn't pass one. */
export function eventKindForStatus(status: number): string {
  if (status >= 500) return "api.5xx";
  if (status >= 400) return "api.4xx";
  return "api.ok";
}
