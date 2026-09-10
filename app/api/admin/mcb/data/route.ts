import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { requirePermission, isResponse } from "@/server/admin-guard";

// MUST match PAGE_SIZE in app/admin/(protected)/mcb/page.tsx and
// McbDashboard.tsx. 100 rows/page keeps the React commit cheap.
const PAGE_SIZE = 100;

const SCHOOLS: { school_code: string; mcb_branch: string }[] = [
  { school_code: "SASKS", mcb_branch: "St. ANDREWS SCHOOL KEESARA" },
  { school_code: "SASBP", mcb_branch: "St. ANDREWS HIGH SCHOOL SUCHITRA" },
  { school_code: "SMSAW", mcb_branch: "St. MICHAELS SCHOOL[ALWAL]" },
  { school_code: "WMAJK", mcb_branch: "Winmore Academy Jakkur" },
  { school_code: "WMAWF", mcb_branch: "Winmore Academy Whitefield" },
  { school_code: "CAGSM", mcb_branch: "Crimson Anisha Global School Marunji" },
  { school_code: "CAGSU", mcb_branch: "Crimson Anisha Global School Undri" },
];

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

const isYmd = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isYm = (s: string | null) => !!s && /^\d{4}-\d{2}$/.test(s);

export async function GET(req: NextRequest) {
  const guard = await requirePermission("mcb.read");
  if (isResponse(guard)) return guard;

  const u = req.nextUrl.searchParams;
  const tab = u.get("tab") === "fees" ? "fees" : "master";
  const access = u.get("access") === "granted" || u.get("access") === "not" ? u.get("access")! : "all";
  const schoolCode = SCHOOLS.find((s) => s.school_code === u.get("school"))?.school_code ?? SCHOOLS[0].school_code;
  const activeSchool = SCHOOLS.find((s) => s.school_code === schoolCode)!;
  const page = Math.max(1, Number(u.get("page") ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const fromR = isYmd(u.get("from")) ? u.get("from")! : today;
  const toR = isYmd(u.get("to")) ? u.get("to")! : today;
  const from = fromR <= toR ? fromR : toR;
  const to = fromR <= toR ? toR : fromR;

  // Free-text search across enrolment number, student name, mobile, and the
  // father/mother phone numbers stored in raw JSON. Digits-only input is
  // matched as a suffix on phone fields so users can paste "9876543210" or
  // "+91 98765 43210" interchangeably.
  const qRaw = (u.get("q") ?? "").trim();
  const q = qRaw.slice(0, 64);
  const qDigits = q.replace(/\D/g, "");
  const like = `%${q}%`;
  // Search predicate, parameterised. `raw->>'StudentReferencesCode'` is
  // the school-facing short id (WF260136 / SC260197 / AW250116) and is
  // what users actually search by.
  const phoneSfx = "%" + qDigits;
  const searchFilter = q
    ? sql`(
        enrolment_number ILIKE ${like}
        OR student_name ILIKE ${like}
        OR mobile_number ILIKE ${like}
        OR (raw->>'StudentReferencesCode') ILIKE ${like}
        ${qDigits.length >= 4 ? sql`OR regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g') LIKE ${phoneSfx}
          OR regexp_replace(coalesce(raw->>'FatherPhone', ''), '\D', '', 'g') LIKE ${phoneSfx}
          OR regexp_replace(coalesce(raw->>'MotherPhone', ''), '\D', '', 'g') LIKE ${phoneSfx}` : sql``}
      )`
    : sql`true`;
  const searchFilterS = q
    ? sql`(
        s.enrolment_number ILIKE ${like}
        OR s.student_name ILIKE ${like}
        OR s.mobile_number ILIKE ${like}
        OR (s.raw->>'StudentReferencesCode') ILIKE ${like}
        ${qDigits.length >= 4 ? sql`OR regexp_replace(coalesce(s.mobile_number, ''), '\D', '', 'g') LIKE ${phoneSfx}
          OR regexp_replace(coalesce(s.raw->>'FatherPhone', ''), '\D', '', 'g') LIKE ${phoneSfx}
          OR regexp_replace(coalesce(s.raw->>'MotherPhone', ''), '\D', '', 'g') LIKE ${phoneSfx}` : sql``}
      )`
    : sql`true`;

  const accessFilter =
    access === "granted"
      ? sql`website_access = true`
      : access === "not"
        ? sql`website_access = false`
        : sql`true`;

  // Month filter (master tab) — YYYY-MM. When set, restricts to students
  // whose most recent Tuition fee payment fell in that calendar month.
  // Implemented as a HAVING-like clause on the LATERAL feeagg join.
  const month = isYm(u.get("month")) ? u.get("month")! : null;
  const monthFilter = month
    ? sql`feeagg.last_tuition_paid_date >= (${month + "-01"})::date
          AND feeagg.last_tuition_paid_date < ((${month + "-01"})::date + INTERVAL '1 month')`
    : sql`true`;
  const monthFilterCount = month
    ? sql`EXISTS (
        SELECT 1 FROM mcb_fee_payments p
         WHERE p.enrolment_number = s.enrolment_number
           AND p.fee_head = 'Tuition fee'
           AND p.payment_date >= (${month + "-01"})::date
           AND p.payment_date < ((${month + "-01"})::date + INTERVAL '1 month')
           AND p.payment_date = (
             SELECT MAX(p2.payment_date) FROM mcb_fee_payments p2
              WHERE p2.enrolment_number = s.enrolment_number AND p2.fee_head = 'Tuition fee'
           )
      )`
    : sql`true`;

  if (tab === "master") {
    const [counts, total, rows] = await Promise.all([
      db.execute(sql`
        SELECT s.school_name AS mcb_branch, count(*)::int AS n
        FROM mcb_students s
        WHERE s.school_name IS NOT NULL AND ${accessFilter} AND ${searchFilterS} AND ${monthFilterCount}
        GROUP BY s.school_name
      `),
      db.execute(sql`
        SELECT count(*)::int AS n FROM mcb_students s
        WHERE s.school_name = ${activeSchool.mcb_branch} AND ${accessFilter} AND ${searchFilterS} AND ${monthFilterCount}
      `),
      db.execute(sql`
        SELECT s.enrolment_number,
               s.raw->>'StudentReferencesCode' AS reference_code,
               s.student_name, s.school_name, s.grade, s.section,
               s.mobile_number, s.email,
               s.raw->'Gender' AS gender_raw,
               s.raw->>'FatherName'    AS father_name,
               s.raw->>'MotherName'    AS mother_name,
               s.raw->>'FatherPhone'   AS father_phone,
               s.raw->>'MotherPhone'   AS mother_phone,
               s.raw->>'FatherEmailID' AS father_email,
               s.raw->>'MotherEmailID' AS mother_email,
               s.last_fee_paid_date, s.last_fee_paid_amount,
               s.website_access, s.website_access_at, s.website_access_by,
               -- Per-head latest-paid pivot. Strings match MCB's canonical
               -- fee_head verbatim (case-sensitive); changing these will
               -- silently zero out the columns, so verify against
               -- mcb_fee_payments before editing.
               feeagg.last_tuition_paid_date,
               feeagg.last_magic_box_paid_date
        FROM mcb_students s
        LEFT JOIN LATERAL (
          SELECT
            MAX(payment_date) FILTER (WHERE fee_head = 'Tuition fee') AS last_tuition_paid_date,
            MAX(payment_date) FILTER (WHERE fee_head = 'Magic Box')   AS last_magic_box_paid_date
          FROM mcb_fee_payments
          WHERE enrolment_number = s.enrolment_number
        ) feeagg ON true
        WHERE s.school_name = ${activeSchool.mcb_branch} AND ${accessFilter} AND ${searchFilterS} AND ${monthFilter}
        ORDER BY s.student_name
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
      `),
    ]);
    return NextResponse.json({
      tab,
      page,
      total: Number(rowsOf<{ n: number }>(total)[0]?.n ?? 0),
      counts: rowsOf<{ mcb_branch: string; n: number }>(counts),
      rows: rowsOf(rows),
    });
  }

  // fees tab
  const [counts, total, rows] = await Promise.all([
    db.execute(sql`
      SELECT s.school_name AS mcb_branch, count(DISTINCT s.enrolment_number)::int AS n
      FROM mcb_students s
      JOIN mcb_fee_payments p USING (enrolment_number)
      WHERE p.payment_date BETWEEN ${from} AND ${to}
        AND ${searchFilterS}
      GROUP BY s.school_name
    `),
    db.execute(sql`
      SELECT count(DISTINCT s.enrolment_number)::int AS n
      FROM mcb_students s
      JOIN mcb_fee_payments p USING (enrolment_number)
      WHERE p.payment_date BETWEEN ${from} AND ${to}
        AND s.school_name = ${activeSchool.mcb_branch}
        AND ${searchFilterS}
    `),
    db.execute(sql`
      SELECT s.enrolment_number,
             s.raw->>'StudentReferencesCode' AS reference_code,
             s.student_name, s.grade, s.section,
             s.mobile_number, s.email,
             s.last_fee_paid_date, s.last_fee_paid_amount,
             s.website_access, s.website_access_at, s.website_access_by,
             s.raw->>'FatherName'    AS father_name,
             s.raw->>'MotherName'    AS mother_name,
             s.raw->>'FatherPhone'   AS father_phone,
             s.raw->>'MotherPhone'   AS mother_phone,
             s.raw->>'FatherEmailID' AS father_email,
             s.raw->>'MotherEmailID' AS mother_email,
             s.raw->'Gender'         AS gender_raw,
             agg.day_amount, agg.day_receipts, agg.last_paid_in_range
      FROM mcb_students s
      JOIN LATERAL (
        SELECT sum(amount)::numeric AS day_amount,
               count(*)::int        AS day_receipts,
               max(payment_date)    AS last_paid_in_range
        FROM mcb_fee_payments
        WHERE enrolment_number = s.enrolment_number
          AND payment_date BETWEEN ${from} AND ${to}
      ) agg ON agg.day_receipts > 0
      WHERE s.school_name = ${activeSchool.mcb_branch}
        AND ${searchFilterS}
      ORDER BY s.student_name
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `),
  ]);

  return NextResponse.json({
    tab,
    page,
    total: Number(rowsOf<{ n: number }>(total)[0]?.n ?? 0),
    counts: rowsOf<{ mcb_branch: string; n: number }>(counts),
    rows: rowsOf(rows),
  });
}
