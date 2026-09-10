import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import McbDashboard from "./McbDashboard";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

// Keep in sync with PAGE_SIZE in McbDashboard.tsx and /api/admin/mcb/data.
// 100 keeps the initial render snappy (largest school is ~6k students; at
// 5000 we were rendering ~60k DOM cells in one commit and freezing the tab).
const PAGE_SIZE = 100;
const DEFAULT_BRANCH = "St. ANDREWS SCHOOL KEESARA"; // matches SCHOOLS[0] in McbDashboard

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export default async function McbPage() {
  const guard = await requireAnyPermission("mcb.read", "mcb.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  // Tiny initial payload — master tab, default school (SASKS), access=all, page 1.
  // After mount, the client component takes over and every interaction is a
  // small JSON fetch to /api/admin/mcb/data instead of a full RSC roundtrip.
  const [counts, total, rows, syncStatusRows] = await Promise.all([
    db.execute(sql`
      SELECT school_name AS mcb_branch, count(*)::int AS n
      FROM mcb_students WHERE school_name IS NOT NULL GROUP BY school_name
    `),
    db.execute(sql`
      SELECT count(*)::int AS n FROM mcb_students WHERE school_name = ${DEFAULT_BRANCH}
    `),
    db.execute(sql`
      SELECT enrolment_number, student_name, grade, section,
             mobile_number, email,
             raw->'Gender' AS gender_raw,
             last_fee_paid_date, last_fee_paid_amount,
             website_access, website_access_at, website_access_by
      FROM mcb_students
      WHERE school_name = ${DEFAULT_BRANCH}
      ORDER BY student_name
      LIMIT ${PAGE_SIZE} OFFSET 0
    `),
    // Heartbeat for the MCB → admin pipeline. Surfaced as pills in the
    // dashboard header so ops notices silent drift (e.g. fees window too
    // narrow, MCB-side back-stamping, credential expiry) within a day
    // instead of after a parent complaint. Cron runs at 01:30 IST nightly.
    db.execute(sql`
      SELECT
        (SELECT MAX(synced_at) FROM mcb_students)                    AS students_last_synced,
        (SELECT MAX(synced_at) FROM mcb_fee_payments)                AS fees_last_synced,
        (SELECT MAX(payment_date) FROM mcb_fee_payments)             AS fees_last_payment_date,
        (SELECT COUNT(*)::int   FROM mcb_fee_payments
           WHERE synced_at > now() - INTERVAL '24 hours')            AS fees_rows_last_24h
    `),
  ]);

  const [s] = rowsOf<{
    students_last_synced: string | null;
    fees_last_synced: string | null;
    fees_last_payment_date: string | null;
    fees_rows_last_24h: number | null;
  }>(syncStatusRows);

  return (
    <McbDashboard
      initialData={{
        tab: "master",
        page: 1,
        total: Number(rowsOf<{ n: number }>(total)[0]?.n ?? 0),
        counts: rowsOf<{ mcb_branch: string; n: number }>(counts),
        rows: rowsOf(rows),
        syncStatus: {
          studentsLastSynced: s?.students_last_synced ?? null,
          feesLastSynced: s?.fees_last_synced ?? null,
          feesLastPaymentDate: s?.fees_last_payment_date ?? null,
          feesRowsLast24h: Number(s?.fees_rows_last_24h ?? 0),
        },
      }}
    />
  );
}
