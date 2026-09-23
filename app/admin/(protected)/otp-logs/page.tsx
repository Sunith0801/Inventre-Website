import { desc, and, eq, ilike, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { otpLogs } from "@/db/schema";
import {
  PageHeader,
  Card,
} from "@/components/admin/ui/primitives";
import { OtpLogsLiveTable, type OtpLogRow } from "@/components/admin/OtpLogsLiveTable";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function OtpLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; purpose?: string; event?: string; since?: string; page?: string }>;
}) {
  const guard = await requireAnyPermission("otp-logs.read", "otp-logs.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { phone, purpose, event, since, page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const sinceDate =
    since === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0))
      : since === "7d"
        ? new Date(Date.now() - 7 * 86400_000)
        : since === "30d"
          ? new Date(Date.now() - 30 * 86400_000)
          : null;

  const conds = [
    phone ? ilike(otpLogs.phone, `%${phone}%`) : undefined,
    purpose ? eq(otpLogs.purpose, purpose) : undefined,
    event ? eq(otpLogs.event, event) : undefined,
    sinceDate ? gte(otpLogs.createdAt, sinceDate) : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: otpLogs.id,
        createdAt: otpLogs.createdAt,
        phone: otpLogs.phone,
        purpose: otpLogs.purpose,
        event: otpLogs.event,
        // sealed code never leaves the server; see /api/admin/data/otp-logs/reveal
        hasCode: sql<boolean>`(${otpLogs.otpCode} is not null)`,
        transactionId: otpLogs.transactionId,
        error: otpLogs.error,
        ip: otpLogs.ip,
      })
      .from(otpLogs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(otpLogs.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ total: db.$count(otpLogs, conds.length ? and(...conds) : undefined) })
      .from(otpLogs),
  ]);

  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));

  function qs(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = { phone, purpose, event, since, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) p.set(k, v);
    }
    return `?${p}`;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Auth"
        title="OTP Logs"
        description={`${Number(total).toLocaleString()} total entries · all OTP send and verify events`}
      />

      {/* Filters */}
      <form method="GET" className="mb-4 flex flex-wrap gap-3">
        <input
          name="phone"
          defaultValue={phone}
          placeholder="Filter by phone…"
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <select
          name="purpose"
          defaultValue={purpose ?? ""}
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 focus:border-ink-900 focus:outline-none"
        >
          <option value="">All purposes</option>
          <option value="login">Login</option>
          <option value="first-time">First time</option>
          <option value="recover-old">Recovery (old)</option>
          <option value="recover-new">Recovery (new)</option>
        </select>
        <select
          name="event"
          defaultValue={event ?? ""}
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 focus:border-ink-900 focus:outline-none"
        >
          <option value="">All events</option>
          <option value="sent">Sent</option>
          <option value="send_failed">Send failed</option>
          <option value="verified">Verified</option>
          <option value="verify_failed">Verify failed</option>
        </select>
        <select
          name="since"
          defaultValue={since ?? ""}
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 focus:border-ink-900 focus:outline-none"
        >
          <option value="">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <input type="hidden" name="page" value="1" />
        <button
          type="submit"
          className="h-9 rounded-lg bg-ink-900 px-4 text-[13px] font-semibold text-white hover:bg-ink-700"
        >
          Filter
        </button>
        <a
          href="/admin/otp-logs"
          className="h-9 inline-flex items-center rounded-lg border border-ink-200 px-4 text-[13px] font-semibold text-ink-600 hover:bg-ink-50"
        >
          Clear
        </a>
      </form>

      <Card padded={false}>
        <div className="p-3 lg:p-4">
          <OtpLogsLiveTable
            initialRows={rows as unknown as OtpLogRow[]}
            filterParams={{ phone, purpose, event, since }}
            polling={page === 1}
            canReveal={guard.permissions.has("otp-logs.write")}
          />
        </div>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-[13px]">
          {page > 1 && (
            <a href={qs({ page: String(page - 1) })} className="rounded-lg border border-ink-200 px-3 py-1.5 hover:bg-ink-50">
              ← Prev
            </a>
          )}
          <span className="text-ink-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <a href={qs({ page: String(page + 1) })} className="rounded-lg border border-ink-200 px-3 py-1.5 hover:bg-ink-50">
              Next →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
