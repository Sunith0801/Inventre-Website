/**
 * MyClassBoard (MCB) → Inventre nightly import.
 *
 * Pulls the active-year student roster + a sliding window of fee receipts,
 * filters down to the schools in MCB_SCHOOL_ALLOWLIST, and upserts into
 * `mcb_students` / `mcb_fee_payments`. The admin /admin/mcb page reads from
 * these tables and lets the admin flip `mcb_students.website_access` per row.
 *
 * Env (defaults baked in for the current MCB tenant):
 *   MCB_API_BASE              https://api.myclassboard.com
 *   MCB_API_KEY               required (api_key header)
 *   MCB_TOKEN_ID              required (TokenID query param)
 *   MCB_BRANCH_IDS            "52,70,230,225,226,102,103"  (St Andrews × 2, St
 *                             Michaels, Winmore × 2 — see GET_Branches)
 *   MCB_ORGANISATION_ID       39
 *   MCB_ACADEMIC_YEAR_IDS     "17,18"  (2025-26 and 2026-27 only)
 *   MCB_FEE_WINDOW_DAYS       35       (rolling window for the nightly run)
 *
 * Flags:
 *   --debug   print one sample row from each MCB endpoint and exit
 *   --from / --to   one-shot historical fee window override (MM/DD/YYYY)
 *
 * Exits 0 on success, 1 on error. Idempotent — safe to run repeatedly.
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env") });

import postgres from "postgres";

const MCB_API_BASE = process.env.MCB_API_BASE || "https://api.myclassboard.com";
const MCB_API_KEY = process.env.MCB_API_KEY || "";
const MCB_TOKEN_ID = process.env.MCB_TOKEN_ID || "";
const MCB_BRANCH_IDS = (process.env.MCB_BRANCH_IDS || "52,70,230,225,226,102,103")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MCB_ORGANISATION_ID = process.env.MCB_ORGANISATION_ID || "39";
const MCB_ACADEMIC_YEAR_IDS = (process.env.MCB_ACADEMIC_YEAR_IDS || "17,18")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MCB_FEE_WINDOW_DAYS = Number(process.env.MCB_FEE_WINDOW_DAYS || "35");

const args = process.argv.slice(2);
const DEBUG = args.includes("--debug");
/** Delete receivables MCB stopped returning. Full-window runs only. */
const PRUNE = args.includes("--prune");
function flagValue(name: string): string | null {
  const i = args.findIndex((a) => a === name || a.startsWith(name + "="));
  if (i < 0) return null;
  const a = args[i];
  if (a.includes("=")) return a.split("=").slice(1).join("=");
  return args[i + 1] || null;
}

// MCB returns CamelCase fields; pick whichever variant is present. We keep
// the raw row in jsonb so adding fallbacks later doesn't need a re-import.
function pick<T = string>(o: any, ...keys: string[]): T | null {
  for (const k of keys) {
    if (o && o[k] != null && o[k] !== "") return o[k] as T;
  }
  return null;
}

function fmtMcbDate(d: Date): string {
  // MCB expects MM/DD/YYYY (URL-encoded by URLSearchParams).
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function parseMcbDate(s: string | null | undefined): string | null {
  // Accept "MM/DD/YYYY", ISO, "DD-MM-YYYY", or "DD Mon YYYY".
  // Return ISO yyyy-mm-dd.
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (m) {
    const mm = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

async function mcbGet(pathName: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ TokenID: MCB_TOKEN_ID, ...params });
  const url = `${MCB_API_BASE}${pathName}?${qs.toString()}`;
  const r = await fetch(url, {
    headers: { Accept: "application/json", api_key: MCB_API_KEY },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`MCB ${pathName} ${r.status}: ${body.slice(0, 400)}`);
  }
  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  if (!ct.includes("json") && !text.trim().startsWith("[") && !text.trim().startsWith("{")) {
    throw new Error(`MCB ${pathName}: non-JSON response (${ct}): ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

function unwrap(payload: any): any[] {
  // MCB sometimes wraps the array in {Data: [...]} or {Result: [...]}.
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const k of ["Data", "data", "Result", "result", "Table", "Records"]) {
      if (Array.isArray(payload[k])) return payload[k];
    }
  }
  return [];
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[import-mcb] start ${startedAt}`);

  if (!MCB_API_KEY || !MCB_TOKEN_ID) {
    console.error("[import-mcb] MCB_API_KEY / MCB_TOKEN_ID not set");
    process.exit(1);
  }
  const dsn = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL;
  if (!dsn) {
    console.error("[import-mcb] DATABASE_URL not set");
    process.exit(1);
  }
  const sql = postgres(dsn, { prepare: false });
  let exitCode = 0;

  try {
    // ── 1. Students ── fetch all branches × years, dedupe in memory, bulk
    // upsert. We dedupe because the AY 17 and AY 18 student lists overlap
    // on enrolment_number (same student across years) and ON CONFLICT can't
    // hit the same row twice in a single statement. The AY 18 (current
    // year) row wins because we iterate years in ascending order.
    let studentsFetched = 0;
    let sampleStudent: any = null;
    const studentRows = new Map<string, Record<string, any>>();

    for (const branchId of MCB_BRANCH_IDS) {
      for (const ayId of MCB_ACADEMIC_YEAR_IDS) {
        const studentsRaw = unwrap(
          await mcbGet("/api/ClassAcademicData/GET_StudentsByAcademicYear", {
            BranchID: branchId,
            AcademicYearID: ayId,
          })
        );
        studentsFetched += studentsRaw.length;
        if (!sampleStudent && studentsRaw[0]) sampleStudent = studentsRaw[0];
        console.log(
          `[import-mcb] students Branch=${branchId} AY=${ayId} → ${studentsRaw.length}`
        );

        for (const row of studentsRaw) {
          const enrolment = pick<string>(
            row,
            "StudentEnrollmentCode",
            "AdmissionNumber",
            "AdmissionNo",
            "EnrollmentNumber",
            "EnrolmentNumber",
            "RegistrationNumber",
            "StudentCode"
          );
          if (!enrolment) continue;
          const schoolName = pick<string>(row, "BranchName", "SchoolName", "Branch");
          const studentName = pick<string>(row, "FullName", "StudentName", "Name");
          const grade = pick<string>(row, "ClassName", "Class", "Grade");
          const section = pick<string>(row, "Section", "SectionName");
          const mobile =
            pick<string>(
              row,
              "FatherPhone",
              "MotherPhone",
              "MobileNumber",
              "Mobile",
              "ParentMobile"
            ) || null;
          const email =
            pick<string>(
              row,
              "FatherEmailID",
              "MotherEmailID",
              "EmailID",
              "Email",
              "ParentEmail"
            ) || null;

          studentRows.set(String(enrolment), {
            enrolment_number: String(enrolment),
            student_name: studentName,
            school_name: schoolName,
            grade: grade,
            section: section,
            mobile_number: mobile,
            email: email,
            raw: row,
          });
        }
      }
    }
    if (DEBUG && sampleStudent) {
      console.log("[import-mcb] sample student:", JSON.stringify(sampleStudent, null, 2));
    }

    const STUDENT_CHUNK = 500;
    const studentArr = [...studentRows.values()];
    for (let i = 0; i < studentArr.length; i += STUDENT_CHUNK) {
      const chunk = studentArr.slice(i, i + STUDENT_CHUNK);
      await sql`
        INSERT INTO mcb_students ${sql(
          chunk,
          "enrolment_number",
          "student_name",
          "school_name",
          "grade",
          "section",
          "mobile_number",
          "email",
          "raw"
        )}
        ON CONFLICT (enrolment_number) DO UPDATE SET
          student_name = EXCLUDED.student_name,
          school_name  = EXCLUDED.school_name,
          grade        = EXCLUDED.grade,
          section      = EXCLUDED.section,
          mobile_number= EXCLUDED.mobile_number,
          email        = EXCLUDED.email,
          raw          = EXCLUDED.raw,
          synced_at    = now()
      `;
    }
    const allowedEnrolments = new Set(studentRows.keys());
    console.log(
      `[import-mcb] students: fetched=${studentsFetched} upserted=${studentArr.length} unique_enrolments=${allowedEnrolments.size}`
    );

    // ── 2. Fee receipts ── loop over branches × academic years.
    const fromFlag = flagValue("--from");
    const toFlag = flagValue("--to");
    const now = new Date();
    const fromDate = fromFlag
      ? fromFlag
      : fmtMcbDate(new Date(now.getTime() - MCB_FEE_WINDOW_DAYS * 86400_000));
    const toDate = toFlag ? toFlag : fmtMcbDate(now);

    let feesFetched = 0;
    let feeWritten = 0;
    let feeSkipped = 0;
    let sampleFee: any = null;
    const allFees: any[] = [];
    /** What each (branch, academic year) actually returned this run — the
     *  prune below needs it to tell "MCB has nothing here" apart from "MCB
     *  is down / the window was narrow". */
    const feeScopes: { branchId: string; ayId: string; fetched: number }[] = [];

    for (const branchId of MCB_BRANCH_IDS) {
      for (const ayId of MCB_ACADEMIC_YEAR_IDS) {
        const feesRaw = unwrap(
          await mcbGet("/api/StudentFeeData/GET_StudentFeeReceivables_Tally", {
            FromDate: fromDate,
            ToDate: toDate,
            BranchID: branchId,
            OrganisationID: MCB_ORGANISATION_ID,
            AcademicYearID: ayId,
          })
        );
        feesFetched += feesRaw.length;
        feeScopes.push({ branchId, ayId, fetched: feesRaw.length });
        if (!sampleFee && feesRaw[0]) sampleFee = feesRaw[0];
        console.log(
          `[import-mcb] fees Branch=${branchId} AY=${ayId} ${fromDate}..${toDate} → ${feesRaw.length}`
        );
        allFees.push(...feesRaw);
      }
    }

    if (DEBUG) {
      console.log("[import-mcb] sample fee row:", JSON.stringify(sampleFee, null, 2));
      console.log("[import-mcb] DEBUG mode — not writing fees, exiting");
      await sql.end({ timeout: 5 });
      process.exit(0);
    }
    console.log(`[import-mcb] fees: fetched ${feesFetched} total rows`);
    if (feesFetched === 0) {
      // Grep-able heartbeat warning so a multi-day zero streak is visible
      // in the cron log without having to compute counts per run. Picked
      // up by the /admin/mcb dashboard's `fees_rows_last_24h` query, which
      // turns the "Fees last synced" pill amber when this fires.
      console.warn(
        `[import-mcb] WARN: zero fee rows fetched across all branches ` +
          `(window ${fromDate}..${toDate}). ` +
          `Likely upstream MCB has no posted receipts in window, OR the ` +
          `window is too narrow for MCB's back-stamped entries. ` +
          `If this fires N days in a row, widen MCB_FEE_WINDOW_DAYS in ` +
          `.env.deploy or run a one-shot recovery via ` +
          `MCB_FEE_WINDOW_DAYS=90 npx tsx scripts/import-from-mcb.ts.`
      );
    }

    // Dedupe fee rows by primary key (enrolment_number, payment_date,
    // receipt_no) — same receipt can appear if a date range straddles two
    // queries, and ON CONFLICT in a single bulk insert can't hit the same
    // row twice.
    const feeMap = new Map<string, Record<string, any>>();
    for (const r of allFees) {
      const enrolment = pick<string>(
        r,
        "StudentEnrollmentCode",
        "AdmissionNumber",
        "AdmissionNo",
        "EnrollmentNumber",
        "EnrolmentNumber",
        "RegistrationNumber",
        "StudentCode"
      );
      if (!enrolment) {
        feeSkipped++;
        continue;
      }
      if (!allowedEnrolments.has(String(enrolment))) {
        feeSkipped++;
        continue;
      }
      const paymentDate = parseMcbDate(
        pick<string>(r, "VoucherDate", "ReceiptDate", "PaidDate", "TransactionDate", "Date")
      );
      if (!paymentDate) {
        feeSkipped++;
        continue;
      }
      const receiptRaw = pick<string | number>(
        r,
        "ReceiptNumber",
        "ReceiptNo",
        "ReceiptID",
        "FeeInstallmentStudentID"
      );
      const receiptNo = receiptRaw == null ? "" : String(receiptRaw);
      const amount = Number(
        pick(r, "InstallmentPaidAmount", "PaidAmount", "Amount", "ReceivedAmount", "FeeAmount") ?? 0
      );
      const feeHead = pick<string>(r, "FeeTypeName", "FeeHead", "FeeName", "FeeType");

      const key = `${enrolment}|${paymentDate}|${receiptNo}`;
      feeMap.set(key, {
        enrolment_number: String(enrolment),
        payment_date: paymentDate,
        receipt_no: receiptNo,
        amount: Number.isFinite(amount) ? amount : null,
        fee_head: feeHead,
        raw: r,
      });
    }

    const FEE_CHUNK = 500;
    const feeArr = [...feeMap.values()];
    for (let i = 0; i < feeArr.length; i += FEE_CHUNK) {
      const chunk = feeArr.slice(i, i + FEE_CHUNK);
      await sql`
        INSERT INTO mcb_fee_payments ${sql(
          chunk,
          "enrolment_number",
          "payment_date",
          "receipt_no",
          "amount",
          "fee_head",
          "raw"
        )}
        ON CONFLICT (enrolment_number, payment_date, receipt_no) DO UPDATE SET
          amount   = EXCLUDED.amount,
          fee_head = EXCLUDED.fee_head,
          raw      = EXCLUDED.raw,
          synced_at= now()
      `;
      feeWritten += chunk.length;
    }
    console.log(
      `[import-mcb] fees: fetched=${feesFetched} written=${feeWritten} skipped=${feeSkipped}`
    );

    // ── 2b. Prune receivables MCB no longer bills ──────────────────────
    // A cancelled or re-issued bill simply stops being returned. The upsert
    // above can never notice that, so orphans accumulated silently: on
    // 2026-08-27 there were 1,105 such rows for 631 students still showing
    // Rs 1.17 Cr as DUE that MCB had dropped.
    //
    // Only safe after a FULL-window run — with a narrow window most rows are
    // legitimately absent and this would delete the year. Hence --prune,
    // plus a per-scope guard: a scope that returned nothing is skipped
    // outright, because "empty" is far more likely to be an upstream hiccup
    // than a branch with no fees at all.
    if (PRUNE) {
      let pruned = 0;
      let skippedScopes = 0;
      for (const scope of feeScopes) {
        if (scope.fetched === 0) {
          skippedScopes++;
          console.warn(
            `[import-mcb] prune: SKIPPED branch=${scope.branchId} AY=${scope.ayId} — ` +
              `it returned 0 rows this run; refusing to delete on an empty answer`
          );
          continue;
        }
        const gone = await sql`
          DELETE FROM mcb_fee_payments
          WHERE raw->>'BranchID' = ${scope.branchId}
            AND raw->>'AcademicYearID' = ${scope.ayId}
            AND synced_at < ${startedAt}
          RETURNING 1
        `;
        pruned += gone.length;
        if (gone.length > 0) {
          console.log(
            `[import-mcb] prune: branch=${scope.branchId} AY=${scope.ayId} — ` +
              `removed ${gone.length} row(s) MCB no longer returns`
          );
        }
      }
      console.log(
        `[import-mcb] prune: ${pruned} stale row(s) removed, ${skippedScopes} scope(s) skipped`
      );
    }

    // ── 3. Backfill last_fee_paid_date / amount on mcb_students ──
    await sql`
      UPDATE mcb_students s SET
        last_fee_paid_date   = p.max_date,
        last_fee_paid_amount = p.last_amount
      FROM (
        SELECT DISTINCT ON (enrolment_number)
          enrolment_number,
          payment_date AS max_date,
          amount       AS last_amount
        FROM mcb_fee_payments
        ORDER BY enrolment_number, payment_date DESC, receipt_no DESC
      ) p
      WHERE p.enrolment_number = s.enrolment_number
    `;

    // ── 4. Guardian + student-email reconciliation ──
    // For every student whose enrollment_number matches an mcb_students row,
    // make sure both FatherPhone and MotherPhone from MCB are present on
    // student_guardian_links. The partial unique index
    // `student_guardian_links_unique_phone` (migration 0020) on
    // (student_id, last10(phone_no)) silently drops phones that already
    // exist for that student — that's the "if match do nothing" semantic.
    // Refresh students.student_email_id from mcb_students.email at the same
    // time. See /root/.claude/plans/ultrathink-and-analyze-the-hazy-alpaca.md
    // for the full rationale.

    // guardians.mobile_number has only a *partial* unique index
    // (guardians_unique_phone), which ON CONFLICT can't target via constraint
    // name. Use an anti-join instead — insert only phones that don't already
    // have a guardians row (matched by the same normalised expression the
    // partial index uses). A separate UPDATE then refreshes blank name/email
    // on existing rows from MCB.
    const guardiansInserted = await sql`
      WITH mcb_phones AS (
        SELECT right(regexp_replace(coalesce(m.raw->>'FatherPhone',''), '\D', '', 'g'), 10) AS phone,
               NULLIF(m.raw->>'FatherName','')    AS name,
               NULLIF(m.raw->>'FatherEmailID','') AS email
        FROM mcb_students m
        JOIN students s ON s.enrollment_number = m.enrolment_number
        WHERE m.raw->>'FatherPhone' IS NOT NULL
        UNION ALL
        SELECT right(regexp_replace(coalesce(m.raw->>'MotherPhone',''), '\D','','g'), 10),
               NULLIF(m.raw->>'MotherName',''),
               NULLIF(m.raw->>'MotherEmailID','')
        FROM mcb_students m
        JOIN students s ON s.enrollment_number = m.enrolment_number
        WHERE m.raw->>'MotherPhone' IS NOT NULL
      ),
      uniq AS (
        SELECT DISTINCT ON (phone) phone, name, email
        FROM mcb_phones
        WHERE length(phone) = 10
        ORDER BY phone, (name IS NULL), (email IS NULL)
      )
      INSERT INTO guardians (erp_name, guardian_name, mobile_number, email, email_address)
      SELECT 'MCB-G-' || u.phone, u.name, u.phone, u.email, u.email
      FROM uniq u
      LEFT JOIN guardians g
        ON right(regexp_replace(coalesce(g.mobile_number,''), '\D','','g'), 10) = u.phone
           OR g.erp_name = 'MCB-G-' || u.phone
      WHERE g.id IS NULL
      RETURNING 1
    `;

    const guardiansRefreshed = await sql`
      WITH mcb_phones AS (
        SELECT right(regexp_replace(coalesce(m.raw->>'FatherPhone',''), '\D','','g'), 10) AS phone,
               NULLIF(m.raw->>'FatherName','')    AS name,
               NULLIF(m.raw->>'FatherEmailID','') AS email
        FROM mcb_students m
        WHERE m.raw->>'FatherPhone' IS NOT NULL
        UNION ALL
        SELECT right(regexp_replace(coalesce(m.raw->>'MotherPhone',''), '\D','','g'), 10),
               NULLIF(m.raw->>'MotherName',''),
               NULLIF(m.raw->>'MotherEmailID','')
        FROM mcb_students m
        WHERE m.raw->>'MotherPhone' IS NOT NULL
      ),
      uniq AS (
        SELECT DISTINCT ON (phone) phone, name, email
        FROM mcb_phones
        WHERE length(phone) = 10
        ORDER BY phone, (name IS NULL), (email IS NULL)
      )
      UPDATE guardians g
         SET guardian_name = COALESCE(g.guardian_name, u.name),
             email         = COALESCE(g.email,         u.email),
             email_address = COALESCE(g.email_address, u.email)
      FROM uniq u
      WHERE right(regexp_replace(coalesce(g.mobile_number,''), '\D','','g'), 10) = u.phone
        AND (
              (g.guardian_name IS NULL AND u.name  IS NOT NULL)
           OR (g.email         IS NULL AND u.email IS NOT NULL)
           OR (g.email_address IS NULL AND u.email IS NOT NULL)
        )
      RETURNING 1
    `;

    // student_guardian_links_unique_phone is a partial unique INDEX (not a
    // constraint), so ON CONFLICT ON CONSTRAINT can't reference it. Anti-join
    // to filter out (student_id, phone) pairs that already exist, then assign
    // row_idx per student so the inserted rows append in order.
    const linksAppended = await sql`
      WITH mcb_phones AS (
        SELECT s.id AS student_id,
               right(regexp_replace(coalesce(m.raw->>'FatherPhone',''), '\D','','g'), 10) AS phone,
               NULLIF(m.raw->>'FatherName','')    AS name,
               NULLIF(m.raw->>'FatherEmailID','') AS email,
               'Father' AS relation
        FROM mcb_students m
        JOIN students s ON s.enrollment_number = m.enrolment_number
        WHERE m.raw->>'FatherPhone' IS NOT NULL
        UNION ALL
        SELECT s.id,
               right(regexp_replace(coalesce(m.raw->>'MotherPhone',''), '\D','','g'), 10),
               NULLIF(m.raw->>'MotherName',''),
               NULLIF(m.raw->>'MotherEmailID',''),
               'Mother'
        FROM mcb_students m
        JOIN students s ON s.enrollment_number = m.enrolment_number
        WHERE m.raw->>'MotherPhone' IS NOT NULL
      ),
      existing AS (
        SELECT student_id,
               right(regexp_replace(coalesce(phone_no,''), '\D','','g'), 10) AS phone
        FROM student_guardian_links
      ),
      missing AS (
        SELECT DISTINCT ON (mp.student_id, mp.phone)
               mp.student_id, mp.phone, mp.name, mp.email, mp.relation
        FROM mcb_phones mp
        LEFT JOIN existing e
          ON e.student_id = mp.student_id AND e.phone = mp.phone
        WHERE length(mp.phone) = 10
          AND e.student_id IS NULL
        ORDER BY mp.student_id, mp.phone, mp.relation
      ),
      next_idx AS (
        SELECT s.id AS student_id,
               COALESCE(MAX(l.row_idx), -1) + 1 AS next_row
        FROM students s
        LEFT JOIN student_guardian_links l ON l.student_id = s.id
        GROUP BY s.id
      ),
      row0 AS (
        SELECT DISTINCT ON (student_id)
               student_id, guardian_name, relation, email
        FROM student_guardian_links
        ORDER BY student_id, row_idx ASC
      )
      INSERT INTO student_guardian_links
             (student_id, row_idx, guardian_erp_name, guardian_name, relation, phone_no, email)
      SELECT mp.student_id,
             n.next_row + (ROW_NUMBER() OVER (PARTITION BY mp.student_id ORDER BY mp.relation)) - 1,
             'MCB-G-' || mp.phone,
             COALESCE(mp.name,  r.guardian_name),
             COALESCE(mp.relation, r.relation),
             mp.phone,
             COALESCE(mp.email, r.email)
      FROM missing mp
      JOIN next_idx n USING (student_id)
      LEFT JOIN row0 r USING (student_id)
      RETURNING 1
    `;

    const emailsRefreshed = await sql`
      UPDATE students s
      SET student_email_id = m.email
      FROM mcb_students m
      WHERE s.enrollment_number = m.enrolment_number
        AND m.email IS NOT NULL AND m.email <> ''
        AND (s.student_email_id IS NULL
             OR s.student_email_id = ''
             OR lower(s.student_email_id) <> lower(m.email))
      RETURNING 1
    `;

    console.log(
      `[import-mcb] reconcile: guardians inserted=${guardiansInserted.count} ` +
        `guardians refreshed=${guardiansRefreshed.count} ` +
        `links appended=${linksAppended.count} student emails refreshed=${emailsRefreshed.count}`
    );

    console.log(`[import-mcb] completed ${new Date().toISOString()}`);
  } catch (err: any) {
    console.error(`[import-mcb] FAILED: ${err?.stack || err?.message || err}`);
    exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
  process.exit(exitCode);
}

main();
