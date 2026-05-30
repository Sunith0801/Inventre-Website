import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import McbDashboard from "./McbDashboard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 5000;
const DEFAULT_BRANCH = "St. ANDREWS SCHOOL KEESARA"; // matches SCHOOLS[0] in McbDashboard

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export default async function McbPage() {
  // Tiny initial payload — master tab, default school (SASKS), access=all, page 1.
  // After mount, the client component takes over and every interaction is a
  // small JSON fetch to /api/admin/mcb/data instead of a full RSC roundtrip.
  const [counts, total, rows] = await Promise.all([
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
  ]);

  return (
    <McbDashboard
      initialData={{
        tab: "master",
        page: 1,
        total: Number(rowsOf<{ n: number }>(total)[0]?.n ?? 0),
        counts: rowsOf<{ mcb_branch: string; n: number }>(counts),
        rows: rowsOf(rows),
      }}
    />
  );
}
