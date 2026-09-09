import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { mcbGenderToLabel } from "@/lib/mcb/mappings";

export const dynamic = "force-dynamic";

// Excel (.xlsx) export of /admin/mcb. Honours the same filters as the
// dashboard / data API (tab / school / access / month / from / to / q) but
// emits EVERY matching row instead of one PAGE_SIZE slice — the whole point
// of an export is to escape the pagination the on-screen table imposes.
//
// Mirrors the query shape of app/api/admin/mcb/data/route.ts exactly so the
// export set matches what the admin filtered to on screen; only the
// projection (human-friendly columns) and the missing LIMIT/OFFSET differ.

const SCHOOLS: { school_code: string; mcb_branch: string; name: string }[] = [
  { school_code: "SASKS", mcb_branch: "St. ANDREWS SCHOOL KEESARA", name: "St Andrews Keesara" },
  { school_code: "SASBP", mcb_branch: "St. ANDREWS HIGH SCHOOL SUCHITRA", name: "St Andrews Suchitra" },
  { school_code: "SMSAW", mcb_branch: "St. MICHAELS SCHOOL[ALWAL]", name: "St Michaels Alwal" },
  { school_code: "WMAJK", mcb_branch: "Winmore Academy Jakkur", name: "Winmore Jakkur" },
  { school_code: "WMAWF", mcb_branch: "Winmore Academy Whitefield", name: "Winmore Whitefield" },
  { school_code: "CAGSM", mcb_branch: "Crimson Anisha Global School Marunji", name: "Crimson Anisha Marunji" },
  { school_code: "CAGSU", mcb_branch: "Crimson Anisha Global School Undri", name: "Crimson Anisha Undri" },
];

// Schools where the export should surface the MCB Ref/Adm code
// (StudentReferencesCode) as the enrolment identifier — matches
// REF_CODE_SCHOOLS in McbDashboard.tsx.
const REF_CODE_SCHOOLS = new Set(["SASKS", "SASBP", "SMSAW", "WMAWF"]);

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

const isYmd = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isYm = (s: string | null) => !!s && /^\d{4}-\d{2}$/.test(s);

type Row = {
  enrolment_number: string;
  reference_code: string | null;
  student_name: string | null;
  grade: string | null;
  section: string | null;
  mobile_number: string | null;
  email: string | null;
  gender_raw: unknown;
  father_name: string | null;
  mother_name: string | null;
  father_phone: string | null;
  mother_phone: string | null;
  father_email: string | null;
  mother_email: string | null;
  last_fee_paid_date: string | null;
  last_fee_paid_amount: string | null;
  last_tuition_paid_date: string | null;
  last_magic_box_paid_date: string | null;
  website_access: boolean;
  website_access_at: string | null;
  website_access_by: string | null;
  // fees tab only
  day_amount?: string | null;
  day_receipts?: number | null;
  last_paid_in_range?: string | null;
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  // ISO date (YYYY-MM-DD) keeps Excel sorting sane; the dashboard renders
  // localised dates but a flat export wants an unambiguous sortable value.
  return dt.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission("mcb.read");
  if (isResponse(guard)) return guard;

  const u = req.nextUrl.searchParams;
  const tab = u.get("tab") === "fees" ? "fees" : "master";
  const access = u.get("access") === "granted" || u.get("access") === "not" ? u.get("access")! : "all";
  const schoolCode = SCHOOLS.find((s) => s.school_code === u.get("school"))?.school_code ?? SCHOOLS[0].school_code;
  const activeSchool = SCHOOLS.find((s) => s.school_code === schoolCode)!;
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const fromR = isYmd(u.get("from")) ? u.get("from")! : today;
  const toR = isYmd(u.get("to")) ? u.get("to")! : today;
  const from = fromR <= toR ? fromR : toR;
  const to = fromR <= toR ? toR : fromR;

  const qRaw = (u.get("q") ?? "").trim();
  const q = qRaw.slice(0, 64);
  const qDigits = q.replace(/\D/g, "");
  const like = `%${q}%`;
  const phoneSfx = "%" + qDigits;
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
      ? sql`s.website_access = true`
      : access === "not"
        ? sql`s.website_access = false`
        : sql`true`;

  const month = isYm(u.get("month")) ? u.get("month")! : null;
  const monthFilter = month
    ? sql`feeagg.last_tuition_paid_date >= (${month + "-01"})::date
          AND feeagg.last_tuition_paid_date < ((${month + "-01"})::date + INTERVAL '1 month')`
    : sql`true`;

  let rows: Row[];
  if (tab === "master") {
    const res = await db.execute(sql`
      SELECT s.enrolment_number,
             s.raw->>'StudentReferencesCode' AS reference_code,
             s.student_name, s.grade, s.section,
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
    `);
    rows = rowsOf<Row>(res);
  } else {
    const res = await db.execute(sql`
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
    `);
    rows = rowsOf<Row>(res);
  }

  const refLabel = REF_CODE_SCHOOLS.has(schoolCode) ? "Ref / Adm No" : "Enrolment";
  const displayId = (r: Row) =>
    REF_CODE_SCHOOLS.has(schoolCode) ? r.reference_code || r.enrolment_number : r.enrolment_number;

  let header: string[];
  let aoa: (string | number)[][];

  if (tab === "master") {
    header = [
      refLabel, "Name", "Grade", "Section", "Gender", "Mobile", "Email",
      "Father Name", "Mother Name", "Father Phone", "Mother Phone",
      "Father Email", "Mother Email",
      "Last Tuition Paid", "Last Magic Box Paid",
      "Website Access", "Granted At", "Granted By",
    ];
    aoa = [header];
    for (const r of rows) {
      aoa.push([
        displayId(r) ?? "",
        r.student_name ?? "",
        r.grade ?? "",
        r.section ?? "",
        mcbGenderToLabel(r.gender_raw as boolean | string | null) || "",
        r.mobile_number ?? "",
        r.email ?? "",
        r.father_name ?? "",
        r.mother_name ?? "",
        r.father_phone ?? "",
        r.mother_phone ?? "",
        r.father_email ?? "",
        r.mother_email ?? "",
        fmtDate(r.last_tuition_paid_date),
        fmtDate(r.last_magic_box_paid_date),
        r.website_access ? "Yes" : "No",
        fmtDate(r.website_access_at),
        r.website_access_by ?? "",
      ]);
    }
  } else {
    header = [
      refLabel, "Name", "Grade", "Section", "Parent", "Mobile", "Email",
      "Last Fee Paid", "Last Fee Amount",
      "Paid In Range", "Receipts In Range", "Last Paid In Range",
      "Website Access",
    ];
    aoa = [header];
    for (const r of rows) {
      const parent = r.father_name || r.mother_name || "";
      const mobile =
        (r.mother_phone || r.father_phone || r.mobile_number || "").replace(/\D/g, "").slice(-10) ||
        r.mobile_number ||
        "";
      const email = r.father_email || r.mother_email || r.email || "";
      aoa.push([
        displayId(r) ?? "",
        r.student_name ?? "",
        r.grade ?? "",
        r.section ?? "",
        parent,
        mobile,
        email,
        fmtDate(r.last_fee_paid_date),
        r.last_fee_paid_amount != null ? Number(r.last_fee_paid_amount) : "",
        r.day_amount != null ? Number(r.day_amount) : "",
        r.day_receipts ?? "",
        fmtDate(r.last_paid_in_range),
        r.website_access ? "Yes" : "No",
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = header.map((h) =>
    /Name|Email|Address/i.test(h) ? { wch: 26 } : /Paid|Date|At/i.test(h) ? { wch: 16 } : { wch: 14 }
  );
  if (aoa.length > 1) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: aoa.length - 1, c: header.length - 1 },
      }),
    };
  }
  // INR integer format on the money columns (fees tab only).
  if (tab === "fees") {
    const moneyCols = new Set([8, 9]); // Last Fee Amount, Paid In Range
    for (let r = 1; r < aoa.length; r++) {
      for (const c of moneyCols) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === "number") cell.z = "#,##0";
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tab === "master" ? "Students" : "Fee Payments");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const parts = ["mcb", schoolCode, tab];
  if (tab === "master") {
    if (access !== "all") parts.push(access);
    if (month) parts.push(month);
  } else {
    parts.push(`${from}_to_${to}`);
  }
  if (q) parts.push("filtered");
  parts.push(today);
  const filename = `${parts.join("_")}.xlsx`;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
