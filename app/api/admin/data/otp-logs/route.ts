import { NextResponse } from "next/server";
import { and, desc, eq, gt, gte, ilike } from "drizzle-orm";
import { db } from "@/db/client";
import { otpLogs } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

/**
 * Cursor-paginated read of `otp_logs` for the live admin panel
 * (`app/admin/(protected)/otp-logs/page.tsx` + its OtpLogsLiveTable
 * client component, which polls this every 3 s).
 *
 *   GET /api/admin/data/otp-logs?since_at=<ISO>&phone=&purpose=&event=&since=today|7d|30d
 *
 * Returns up to 50 rows whose `created_at` is strictly newer than
 * `since_at` (the last-known timestamp the client has rendered),
 * ordered newest-first. otp_logs.id is a uuid so we cursor on
 * created_at instead — fine because inserts are monotonic in practice
 * and the duplicate-suppression in the client also dedups by id.
 */
export async function GET(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const sinceAt = url.searchParams.get("since_at");
  const phone = url.searchParams.get("phone");
  const purpose = url.searchParams.get("purpose");
  const event = url.searchParams.get("event");
  const since = url.searchParams.get("since");

  const sinceDate =
    since === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0))
      : since === "7d"
        ? new Date(Date.now() - 7 * 86400_000)
        : since === "30d"
          ? new Date(Date.now() - 30 * 86400_000)
          : null;
  const sinceAtDate = sinceAt ? new Date(sinceAt) : null;

  const conds = [
    phone ? ilike(otpLogs.phone, `%${phone}%`) : undefined,
    purpose ? eq(otpLogs.purpose, purpose) : undefined,
    event ? eq(otpLogs.event, event) : undefined,
    sinceDate ? gte(otpLogs.createdAt, sinceDate) : undefined,
    sinceAtDate && !Number.isNaN(sinceAtDate.getTime())
      ? gt(otpLogs.createdAt, sinceAtDate)
      : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const rows = await db
    .select()
    .from(otpLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(otpLogs.createdAt))
    .limit(50);

  return NextResponse.json({ rows });
}
