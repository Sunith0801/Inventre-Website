import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { db } from "@/db/client";
import { sql, type SQL } from "drizzle-orm";
import { getFeesViewer, viewerHas } from "@/server/fees-auth";

/**
 * MCB fee dashboard data API.
 *
 * Everything here reads `mcb_fee_payments`, which despite its name is a
 * *receivables* table: one row per (student × fee installment) pulled from
 * MCB's GET_StudentFeeReceivables_Tally. Each row carries what was billed,
 * what concession was granted and what has actually been paid — so unpaid
 * installments are present too, which is what makes the "yet to pay" side
 * of this dashboard possible.
 *
 * Money semantics (verified against 208k prod rows, 2026-08-26):
 *   gross      = raw->>'InstallmentAmount'      — sticker amount billed
 *   concession = raw->>'Concession'             — discount on that line
 *   net        = gross - concession             — what the parent owes
 *   paid       = raw->>'InstallmentPaidAmount'  — received so far
 *   balance    = net - paid                     — outstanding (>0 = pending)
 * 194,003 of 208,391 rows satisfy paid = gross - concession exactly; the
 * remainder are genuine part-payments/over-payments, never a broken cast.
 *
 * The school dimension comes from the fee row's own `raw->>'BranchName'`
 * (not a join to mcb_students) so an aggregate never depends on the student
 * master being in sync — only 2 rows out of 208k disagree between the two.
 *
 * Views:
 *   view=coverage  → which instalments are DUE so far, and the same slice
 *                    of the previous year for comparison. NOTE: MCB raises
 *                    the whole year up front — its own "Total Paid & Due"
 *                    report shows all 12 months — but
 *                    GET_StudentFeeReceivables_Tally only returns the
 *                    instalments due to date. So every "billed" figure here
 *                    is really "billed AND due so far".
 *   view=schools   → per-school rollup + academic-year list  (level 1)
 *   view=heads     → per-fee-type rollup for one school      (level 2)
 *   view=students  → per-student rows + installment detail   (level 3)
 * `format=csv` on view=students streams the unpaginated installment-level
 * list for ops.
 */

// `branchId` is MCB's own id, needed because receipts (mcb_fee_transactions)
// are keyed by it while receivables carry the branch NAME.
const SCHOOLS: { code: string; name: string; branch: string; branchId: number }[] = [
  { code: "SASKS", name: "St Andrews Keesara", branch: "St. ANDREWS SCHOOL KEESARA", branchId: 52 },
  { code: "SASBP", name: "St Andrews Suchitra", branch: "St. ANDREWS HIGH SCHOOL SUCHITRA", branchId: 70 },
  { code: "SMSAW", name: "St Michaels Alwal", branch: "St. MICHAELS SCHOOL[ALWAL]", branchId: 230 },
  { code: "WMAJK", name: "Winmore Jakkur", branch: "Winmore Academy Jakkur", branchId: 225 },
  { code: "WMAWF", name: "Winmore Whitefield", branch: "Winmore Academy Whitefield", branchId: 226 },
  // Pune. Added 2026-08-27 — they were always in MCB (our token sees 13
  // branches), the importer was just pinned to the original five.
  { code: "CAGSM", name: "Crimson Anisha Marunji", branch: "Crimson Anisha Global School Marunji", branchId: 102 },
  { code: "CAGSU", name: "Crimson Anisha Undri", branch: "Crimson Anisha Global School Undri", branchId: 103 },
];

/**
 * A receipt line's fee HEAD. MCB writes the transaction fee type as
 * "<head> (<installment>)" — "Tuition fee (August)", "Admission Fee (One
 * Time ( Non Refundable ))" — so the head is everything before the final
 * parenthetical. The inner brackets are why the pattern is greedy.
 */
const HEAD_OF_FEE_TYPE = sql`btrim(regexp_replace(t.fee_type, '\\s*\\(.*\\)$', ''))`;

// Students per page on the level-3 table. Each row carries its nested
// installment array, so 50 keeps the JSON payload ~100KB even for a
// 12-installment tuition head.
const PAGE_SIZE = 50;

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

/**
 * One sheet, built the same way as the /admin/mcb export: a header row with
 * Excel's filter dropdowns switched on, sensible column widths, and money
 * left as NUMBERS with an INR format so the columns still add up in Excel.
 * A CSV cannot carry any of that, which is why these are .xlsx.
 */
function workbook(
  sheetName: string,
  header: string[],
  rows: (string | number | null)[][],
  moneyCols: number[]
): Buffer {
  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = header.map((h) =>
    /Student|Particular|Fee|Installment|Mode|Transaction/i.test(h)
      ? { wch: 28 }
      : /Date|Paid on|Due|Voucher/i.test(h)
        ? { wch: 14 }
        : { wch: 13 }
  );
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(aoa.length - 1, 1), c: header.length - 1 },
    }),
  };
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  const money = new Set(moneyCols);
  for (let r = 1; r < aoa.length; r++) {
    for (const c of money) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") cell.z = "#,##0";
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function xlsxResponse(buf: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

const num2 = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const dateCell = (v: unknown): string => (v ? String(v).slice(0, 10) : "");
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Normalised projection over mcb_fee_payments. Every view builds on this. */
function base(where: SQL) {
  return sql`
    SELECT
      f.enrolment_number,
      f.fee_head,
      f.receipt_no,
      f.payment_date,
      f.raw->>'BranchName'                              AS branch,
      f.raw->>'AcademicYear'                            AS academic_year,
      f.raw->>'InstallmentName'                         AS installment,
      f.raw->>'ClassName'                               AS class_name,
      f.raw->>'Section'                                 AS section,
      f.raw->>'StudentName'                             AS student_name,
      f.raw->>'Status1'                                 AS status1,
      (coalesce(f.raw->>'Status1', 'Active') <> 'Active') AS has_left,
      (NULLIF(f.raw->>'DueDate', ''))::timestamp::date  AS due_date,
      COALESCE(NULLIF(f.raw->>'InstallmentAmount', '')::numeric, 0)     AS gross,
      COALESCE(NULLIF(f.raw->>'Concession', '')::numeric, 0)           AS concession,
      COALESCE(NULLIF(f.raw->>'InstallmentPaidAmount', '')::numeric, 0) AS paid
    FROM mcb_fee_payments f
    WHERE ${where}
  `;
}

export async function GET(req: NextRequest) {
  const me = await getFeesViewer();
  if (!viewerHas(me, "fees.read", "fees.write", "mcb.read", "mcb.write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const u = req.nextUrl.searchParams;
  const view = ["schools", "heads", "students", "coverage"].includes(u.get("view") ?? "")
    ? (u.get("view") as "schools" | "heads" | "students" | "coverage")
    : "schools";

  // Academic year is free text in MCB ("2026-2027"); validate by shape and
  // pass as a parameter, never interpolate.
  const ayRaw = (u.get("ay") ?? "").trim();
  const ay = /^\d{4}-\d{4}$/.test(ayRaw) ? ayRaw : null;
  const ayFilter = ay ? sql`f.raw->>'AcademicYear' = ${ay}` : sql`true`;

  /**
   * MCB's `Status1` is the STUDENT's enrolment status as of now, not a flag
   * on the bill. Verified on 2026-08-28: it is never mixed within one
   * student+year (0 of 16,282 students in 2026-27, 0 of 15,303 in 2025-26),
   * and 2,671 of the 3,023 students marked Inactive in 2025-26 do not appear
   * in 2026-27 at all. They left.
   *
   * So it must NOT be used as a blanket row filter. Last year's leavers had
   * already PAID 96% of what they were billed (Rs 30.48 Cr of Rs 31.64 Cr);
   * dropping their rows deletes that from history and inflates the
   * year-on-year comparison (it moved like-for-like growth from ~+24% to
   * ~+51%). This year's leavers are the opposite — Rs 2.64 Cr billed against
   * Rs 0.62 Cr paid — and chasing them is what made our counts read above
   * MCB's own report (Keesara 1,831 vs 1,790).
   *
   * The rule, applied at every level:
   *   billed / concession / collected → EVERY student, always
   *   outstanding + who to chase      → active students only
   *   the level-3 list                → active only, `inactive=1` includes
   * Leavers are never silently dropped: every view reports their count and
   * their uncollectable balance separately, so the figures still reconcile.
   */
  const includeInactive = u.get("inactive") === "1";
  /** Outstanding is only real if the student is still enrolled. Applies in
   *  EVERY year: a debt owed by someone who has gone is uncollectable
   *  whichever year raised it. */
  const chaseable = sql`NOT has_left`;

  /**
   * HEADCOUNT is different, and this is the subtlety: `has_left` means
   * "gone TODAY", not "gone during the year you are looking at", because
   * MCB re-flags a leaver's whole history. Everyone billed in a CLOSED year
   * was enrolled in it, so counting only today's survivors erased 3,023
   * students who were present and paying all through 2025-26 (headcount
   * read ~12,280 against a true ~15,303).
   *
   * So the enrolled-only headcount — and the matching chase-list default —
   * applies to the year still running, where "has left" and "left during
   * this year" mean the same thing. Closed years count everyone they billed.
   */
  const latestAyRes = await db.execute(
    sql`SELECT max(raw->>'AcademicYear') AS ay FROM mcb_fee_payments`
  );
  const latestAy = rowsOf<{ ay: string | null }>(latestAyRes)[0]?.ay ?? null;
  const currentYear = Boolean(ay && latestAy && ay === latestAy);
  /** Headcount scope: enrolled-only for the live year, everyone otherwise. */
  const enrolled = currentYear ? chaseable : sql`true`;
  /** Chase-list visibility. Operates on base()'s `has_left` column. */
  const visibleFilter =
    includeInactive || !currentYear ? sql`true` : sql`NOT has_left`;

  /**
   * Scope is a SET of schools, not one school. `school=ALL` (or the
   * parameter missing) is every branch — a real scope, not an absent
   * filter, because the console opens consolidated and narrows from there.
   * One code is the old single-school behaviour; several arrive
   * comma-separated ("SASKS,SASBP"). Everything downstream filters on
   * `BranchName IN (...)`, so one school and five take the same path.
   *
   * Unknown codes are an error rather than a silent widening: quietly
   * falling back to "all schools" would answer a narrow question with the
   * whole group's money.
   */
  const schoolParam = (u.get("school") ?? "ALL").trim();
  const allSchools = schoolParam === "ALL" || schoolParam === "";
  const wanted = new Set(
    schoolParam.split(",").map((c) => c.trim()).filter(Boolean)
  );
  const scoped = allSchools ? [] : SCHOOLS.filter((x) => wanted.has(x.code));
  const badScope = !allSchools && scoped.length === 0;
  const scopeCode = allSchools ? "ALL" : scoped.map((x) => x.code).join(",");
  const scopeName = allSchools
    ? "All schools"
    : scoped.length === 1
      ? scoped[0].name
      : `${scoped.length} schools`;
  /** `BranchName IN (…)`. Arrays cannot be bound directly (Drizzle throws
   *  42846 on a JS array), so the list is joined as individual params. */
  const inScope = allSchools
    ? sql`true`
    : sql`f.raw->>'BranchName' IN (${sql.join(
        scoped.map((x) => sql`${x.branch}`),
        sql`, `
      )})`;
  /** Same scope against the receipts table, which keys by MCB branch id. */
  const inScopeReceipts = allSchools
    ? sql`true`
    : sql`t.branch_id IN (${sql.join(
        scoped.map((x) => sql`${x.branchId}`),
        sql`, `
      )})`;
  const head = (u.get("head") ?? "").trim().slice(0, 120) || null;

  // ── Billing coverage ───────────────────────────────────────────────
  // The headline figure is "billed so far", and an academic year is billed
  // in instalments across twelve months — so a year five months in looks
  // catastrophically down on a completed year unless the page says which
  // instalments exist yet. It also answers the only comparison that means
  // anything mid-year: the SAME slice of the previous year.
  if (view === "coverage") {
    const scopeFilter = inScope;

    // The year before the selected one, by MCB's own label ordering.
    const priorRes = ay
      ? await db.execute(sql`
          SELECT DISTINCT raw->>'AcademicYear' AS ay
          FROM mcb_fee_payments
          WHERE raw->>'AcademicYear' < ${ay}
          ORDER BY 1 DESC LIMIT 1
        `)
      : null;
    const priorAy = priorRes ? (rowsOf<{ ay: string }>(priorRes)[0]?.ay ?? null) : null;

    // Instalments are ordered by when they FALL DUE, not alphabetically —
    // "April, August, December…" is meaningless on a fee calendar.
    const instRes = await db.execute(sql`
      SELECT f.raw->>'AcademicYear'                         AS ay,
             f.raw->>'InstallmentName'                      AS installment,
             count(*)::int                                  AS rows,
             count(DISTINCT f.enrolment_number)::int        AS students,
             sum(COALESCE(NULLIF(f.raw->>'InstallmentAmount','')::numeric, 0)) AS gross,
             sum(COALESCE(NULLIF(f.raw->>'InstallmentAmount','')::numeric, 0)
               - COALESCE(NULLIF(f.raw->>'Concession','')::numeric, 0))        AS net,
             -- The TYPICAL due date, not the earliest. min() is wrecked by
             -- outliers: one early admission gives 2026-27's "April" a due
             -- date of Sep 2025, which sorts it after August. The mode is
             -- the date the instalment actually falls due for the cohort.
             mode() WITHIN GROUP (ORDER BY (NULLIF(f.raw->>'DueDate',''))::timestamp::date)
                                                                                AS first_due
      FROM mcb_fee_payments f
      WHERE ${scopeFilter}
        AND f.raw->>'InstallmentName' IS NOT NULL
        AND (f.raw->>'AcademicYear' = ${ay ?? ""} OR f.raw->>'AcademicYear' = ${priorAy ?? ""})
      GROUP BY 1, 2
    `);
    const instRows = rowsOf<Record<string, unknown>>(instRes);

    const current = instRows.filter((r) => r.ay === ay);
    const prior = instRows.filter((r) => r.ay === priorAy);
    const currentNames = new Set(current.map((r) => String(r.installment)));

    // Expected = what the previous year actually billed. It is the only
    // honest yardstick we hold; MCB publishes no fee calendar to us.
    const byName = new Map<string, { name: string; firstDue: string | null; billed: boolean; net: number; priorNet: number }>();
    for (const r of [...prior, ...current]) {
      const name = String(r.installment);
      const existing = byName.get(name);
      const isCurrent = r.ay === ay;
      const entry = existing ?? {
        name,
        firstDue: (r.first_due as string | null) ?? null,
        billed: false,
        net: 0,
        priorNet: 0,
      };
      if (isCurrent) {
        entry.billed = true;
        entry.net += num(r.net);
        entry.firstDue = (r.first_due as string | null) ?? entry.firstDue;
      } else {
        entry.priorNet += num(r.net);
        if (!entry.firstDue) entry.firstDue = (r.first_due as string | null) ?? null;
      }
      byName.set(name, entry);
    }
    // Like-for-like: the previous year restricted to the instalments this
    // year has actually reached.
    const priorSameSlice = prior
      .filter((r) => currentNames.has(String(r.installment)))
      .reduce((t, r) => t + num(r.net), 0);
    const priorFull = prior.reduce((t, r) => t + num(r.net), 0);
    const currentNet = current.reduce((t, r) => t + num(r.net), 0);

    // Sort by position in the FEE year, not by raw date: the two years'
    // due dates are a year apart, so a plain date sort interleaves them and
    // drops last year's "Term 2" in front of this year's "April". The
    // academic year starts in April, so April = 0 … March = 11.
    const fiscalIndex = (d: string | null) => {
      if (!d) return 99;
      const m = Number(String(d).slice(5, 7));
      if (!Number.isFinite(m) || m < 1 || m > 12) return 99;
      return (m - 4 + 12) % 12;
    };
    const ordered = [...byName.values()].sort((a, b) => {
      const fa = fiscalIndex(a.firstDue);
      const fb = fiscalIndex(b.firstDue);
      if (fa !== fb) return fa - fb;
      return a.name.localeCompare(b.name);
    });

    // Club subs, sports kits and one-off trips are real instalments but they
    // are rounding error against tuition, and 13 of them drown the billing
    // calendar the rail exists to show. Anything under half a percent of the
    // year is counted, not drawn.
    const scale = priorFull || currentNet || 0;
    const threshold = scale * 0.005;
    const material = ordered.filter((i) => Math.max(i.net, i.priorNet) >= threshold);
    const minor = ordered.filter((i) => Math.max(i.net, i.priorNet) < threshold);


    const perStudentRes = await db.execute(sql`
      SELECT round(avg(n), 1) AS avg_n FROM (
        SELECT count(*) AS n
        FROM mcb_fee_payments f
        WHERE ${scopeFilter} AND f.raw->>'AcademicYear' = ${ay ?? ""}
        GROUP BY f.enrolment_number
      ) t
    `);
    const priorPerStudentRes = await db.execute(sql`
      SELECT round(avg(n), 1) AS avg_n FROM (
        SELECT count(*) AS n
        FROM mcb_fee_payments f
        WHERE ${scopeFilter} AND f.raw->>'AcademicYear' = ${priorAy ?? ""}
        GROUP BY f.enrolment_number
      ) t
    `);

    return NextResponse.json({
      ay,
      priorAy,
      installments: material.map((i) => ({
        name: i.name,
        billed: i.billed,
        net: i.net,
        priorNet: i.priorNet,
      })),
      billedCount: material.filter((i) => i.billed).length,
      expectedCount: material.length,
      minorCount: minor.length,
      minorNet: minor.reduce((t, i) => t + i.net, 0),
      perStudent: num(rowsOf<{ avg_n: unknown }>(perStudentRes)[0]?.avg_n),
      priorPerStudent: num(rowsOf<{ avg_n: unknown }>(priorPerStudentRes)[0]?.avg_n),
      currentNet,
      priorSameSlice,
      priorFull,
      notYetBilled: Math.max(priorFull - priorSameSlice, 0),
    });
  }

  // ── Level 1: schools ───────────────────────────────────────────────
  if (view === "schools") {
    const [agg, ays] = await Promise.all([
      db.execute(sql`
        WITH b AS (${base(ayFilter)})
        SELECT branch,
               -- Headcount is who is still enrolled, so it reconciles with
               -- MCB's own "Total Paid & Due" (Keesara 1,790, not 1,814).
               -- Leavers stay in the money columns and are reported as
               -- left_students beside them.
               count(DISTINCT enrolment_number)
                 FILTER (WHERE ${enrolled})::int                         AS students,
               count(*)::int                                             AS installments,
               sum(gross)                                                AS gross,
               sum(concession)                                           AS concession,
               sum(paid)                                                 AS paid,
               -- Outstanding = what is still chaseable. A student who has
               -- left owes nothing we can collect, so their balance is
               -- reported on its own below rather than folded in here.
               sum(GREATEST(gross - concession - paid, 0))
                 FILTER (WHERE ${chaseable})                             AS balance,
               count(DISTINCT enrolment_number) FILTER (
                 WHERE ${chaseable} AND gross - concession - paid > 0)::int
                                                                         AS pending_students,
               count(DISTINCT enrolment_number) FILTER (
                 WHERE concession > 0)::int                              AS concession_students,
               count(DISTINCT fee_head)::int                             AS heads,
               count(DISTINCT enrolment_number) FILTER (
                 WHERE has_left)::int                                    AS left_students,
               sum(GREATEST(gross - concession - paid, 0))
                 FILTER (WHERE has_left)                                 AS left_balance
        FROM b GROUP BY branch
      `),
      db.execute(sql`
        SELECT DISTINCT raw->>'AcademicYear' AS ay
        FROM mcb_fee_payments
        WHERE raw->>'AcademicYear' IS NOT NULL
        ORDER BY 1 DESC
      `),
    ]);

    const byBranch = new Map(
      rowsOf<Record<string, unknown>>(agg).map((r) => [String(r.branch), r])
    );
    return NextResponse.json({
      academicYears: rowsOf<{ ay: string }>(ays).map((r) => r.ay),
      schools: SCHOOLS.map((s) => {
        const r = byBranch.get(s.branch);
        const gross = num(r?.gross);
        const concession = num(r?.concession);
        const paid = num(r?.paid);
        return {
          code: s.code,
          name: s.name,
          branch: s.branch,
          students: num(r?.students),
          installments: num(r?.installments),
          heads: num(r?.heads),
          gross,
          concession,
          net: gross - concession,
          paid,
          balance: num(r?.balance),
          pendingStudents: num(r?.pending_students),
          concessionStudents: num(r?.concession_students),
          leftStudents: num(r?.left_students),
          leftBalance: num(r?.left_balance),
        };
      }),
    });
  }

  if (badScope) {
    return NextResponse.json({ error: "unknown school in scope" }, { status: 400 });
  }
  const schoolFilter = inScope;

  // ── Level 2: fee types for one school ──────────────────────────────
  if (view === "heads") {
    const res = await db.execute(sql`
      WITH b AS (${base(sql`${schoolFilter} AND ${ayFilter}`)})
      SELECT fee_head,
             count(DISTINCT enrolment_number)
               FILTER (WHERE ${enrolled})::int                           AS students,
             count(*)::int                                               AS installments,
             sum(gross)                                                  AS gross,
             sum(concession)                                             AS concession,
             sum(paid)                                                   AS paid,
             sum(GREATEST(gross - concession - paid, 0))
               FILTER (WHERE ${chaseable})                               AS balance,
             count(DISTINCT enrolment_number) FILTER (
               WHERE ${chaseable} AND gross - concession - paid > 0)::int AS pending_students,
             count(DISTINCT enrolment_number) FILTER (
               WHERE concession > 0)::int                                AS concession_students,
             count(DISTINCT enrolment_number) FILTER (
               WHERE has_left)::int                                      AS left_students,
             sum(GREATEST(gross - concession - paid, 0))
               FILTER (WHERE has_left)                                   AS left_balance,
             max(CASE WHEN paid > 0 THEN payment_date END)               AS last_paid_date
      FROM b
      GROUP BY fee_head
      ORDER BY sum(gross) DESC
    `);
    // Heads that were COLLECTED but never billed. Suchitra takes ₹2.19 Cr of
    // admission fees for 2026-27 and raises no receivable for any of it, so
    // a list built only from receivables silently hides it. The receipts
    // table is the only place that money exists.
    const receiptBranch = inScopeReceipts;
    const receiptOnlyRes = await db.execute(sql`
      WITH billed AS (
        SELECT DISTINCT f.fee_head
        FROM mcb_fee_payments f
        WHERE ${schoolFilter} AND ${ayFilter} AND f.fee_head IS NOT NULL
      ),
      collected AS (
        SELECT ${HEAD_OF_FEE_TYPE}                       AS fee_head,
               count(*)::int                             AS lines,
               count(DISTINCT t.enrolment_number)::int   AS students,
               sum(t.amount)                             AS paid,
               max(t.paid_date)                          AS last_paid_date
        FROM mcb_fee_transactions t
        WHERE ${receiptBranch}
          AND t.fee_type IS NOT NULL
          ${ay ? sql`AND t.academic_year = ${ay}` : sql``}
        GROUP BY 1
      )
      SELECT c.*
      FROM collected c
      LEFT JOIN billed b ON lower(b.fee_head) = lower(c.fee_head)
      WHERE b.fee_head IS NULL AND c.paid > 0
      ORDER BY c.paid DESC
    `);
    const receiptOnly = rowsOf<Record<string, unknown>>(receiptOnlyRes).map((r) => ({
      feeHead: String(r.fee_head ?? "—"),
      students: num(r.students),
      installments: num(r.lines),
      gross: 0,
      concession: 0,
      net: 0,
      paid: num(r.paid),
      balance: 0,
      pendingStudents: 0,
      concessionStudents: 0,
      leftStudents: 0,
      leftBalance: 0,
      lastPaidDate: (r.last_paid_date as string | null) ?? null,
      /** Nothing was ever billed for this head — the figure is collections. */
      receiptOnly: true as const,
    }));

    return NextResponse.json({
      school: { code: scopeCode, name: scopeName },
      receiptOnly,
      heads: rowsOf<Record<string, unknown>>(res).map((r) => {
        const gross = num(r.gross);
        const concession = num(r.concession);
        return {
          feeHead: String(r.fee_head ?? "—"),
          students: num(r.students),
          installments: num(r.installments),
          gross,
          concession,
          net: gross - concession,
          paid: num(r.paid),
          balance: num(r.balance),
          pendingStudents: num(r.pending_students),
          concessionStudents: num(r.concession_students),
          leftStudents: num(r.left_students),
          leftBalance: num(r.left_balance),
          lastPaidDate: (r.last_paid_date as string | null) ?? null,
          receiptOnly: false as const,
        };
      }),
    });
  }

  // ── Level 3: students under one (school, fee type) ─────────────────
  if (!head) {
    return NextResponse.json({ error: "head is required for this view" }, { status: 400 });
  }

  // A receipt-only head has no receivable rows at all, so the usual query
  // would return an empty table for money that demonstrably exists. Serve
  // those from the receipts instead — different columns, because "billed",
  // "concession" and "balance" are meaningless when nothing was billed.
  if (u.get("source") === "receipts") {
    const rq = (u.get("q") ?? "").trim().slice(0, 64);
    const rLike = `%${rq}%`;
    const rPage = Math.max(1, Number(u.get("page") ?? "1") || 1);

    const rWhere = sql`
      ${inScopeReceipts}
      AND ${HEAD_OF_FEE_TYPE} = ${head}
      ${ay ? sql`AND t.academic_year = ${ay}` : sql``}
      ${
        rq
          ? sql`AND (
              t.enrolment_number ILIKE ${rLike}
              OR t.receipt_no ILIKE ${rLike}
              OR EXISTS (
                SELECT 1 FROM mcb_students s
                WHERE s.enrolment_number = t.enrolment_number
                  AND (s.student_name ILIKE ${rLike}
                       OR (s.raw->>'StudentReferencesCode') ILIKE ${rLike})
              )
            )`
          : sql``
      }
    `;
    const perStudentReceipts = sql`
      SELECT t.enrolment_number,
             max(s.student_name)                         AS student_name,
             max(s.raw->>'ClassName')                    AS class_name,
             max(s.raw->>'Section')                      AS section,
             max(s.raw->>'StudentReferencesCode')        AS reference_code,
             max(coalesce(s.mobile_number, s.raw->>'FatherPhone',
                          s.raw->>'MotherPhone'))        AS mobile,
             count(*)::int                               AS lines,
             sum(t.amount)                               AS paid,
             max(t.paid_date)                            AS last_paid_date,
             (array_agg(DISTINCT t.receipt_no))[1:4]     AS receipts,
             max(t.payment_mode)                         AS payment_mode
      FROM mcb_fee_transactions t
      LEFT JOIN mcb_students s ON s.enrolment_number = t.enrolment_number
      WHERE ${rWhere}
      GROUP BY t.enrolment_number
    `;
    const [rRows, rTot] = await Promise.all([
      db.execute(sql`
        SELECT * FROM (${perStudentReceipts}) x
        ORDER BY paid DESC, student_name
        LIMIT ${PAGE_SIZE} OFFSET ${(rPage - 1) * PAGE_SIZE}
      `),
      db.execute(sql`
        SELECT count(*)::int AS students, sum(paid) AS paid
        FROM (${perStudentReceipts}) x
      `),
    ]);
    const rt = rowsOf<Record<string, unknown>>(rTot)[0] ?? {};
    return NextResponse.json({
      school: { code: scopeCode, name: scopeName },
      feeHead: head,
      source: "receipts" as const,
      page: rPage,
      pageSize: PAGE_SIZE,
      total: num(rt.students),
      grades: [],
      totals: {
        students: num(rt.students),
        paidStudents: num(rt.students),
        pendingStudents: 0,
        partialStudents: 0,
        concessionStudents: 0,
        concession90Students: 0,
        concession50Students: 0,
        gross: 0,
        concession: 0,
        net: 0,
        paid: num(rt.paid),
        balance: 0,
      },
      rows: rowsOf<Record<string, unknown>>(rRows).map((r) => ({
        enrolment: String(r.enrolment_number),
        referenceCode: (r.reference_code as string | null) ?? null,
        name: (r.student_name as string | null) ?? null,
        grade: (r.class_name as string | null) ?? null,
        section: (r.section as string | null) ?? null,
        mobile: (r.mobile as string | null) ?? null,
        lines: num(r.lines),
        paid: num(r.paid),
        lastPaidDate: (r.last_paid_date as string | null) ?? null,
        receipts: ((r.receipts as string[] | null) ?? []).filter(Boolean),
        paymentMode: (r.payment_mode as string | null) ?? null,
      })),
    });
  }

  const status = ["paid", "partial", "pending", "concession", "concession90", "concession50"]
    .includes(u.get("status") ?? "")
    ? (u.get("status") as
        | "paid" | "partial" | "pending" | "concession" | "concession90" | "concession50")
    : "all";
  const grade = (u.get("grade") ?? "").trim().slice(0, 64) || null;
  const q = (u.get("q") ?? "").trim().slice(0, 64);
  const page = Math.max(1, Number(u.get("page") ?? "1") || 1);
  // `csv` is still accepted so old bookmarks keep working; both produce the
  // same .xlsx now — ops open these in Excel, and a CSV loses the number
  // formats and the filter row.
  const isExport = u.get("format") === "xlsx" || u.get("format") === "csv";
  // Two exports, deliberately different shapes: the default is
  // installment-level (what was BILLED), `level=receipts` is receipt-level
  // (what was PAID, with real receipt numbers from mcb_fee_transactions).
  // They cannot be one file — a receipt routinely settles several
  // installments at once, so joining them would multiply the money.
  const csvLevel = u.get("level") === "receipts" ? "receipts" : "installments";

  const gradeFilter = grade ? sql`f.raw->>'ClassName' = ${grade}` : sql`true`;
  const qDigits = q.replace(/\D/g, "");
  const like = `%${q}%`;
  const phoneSfx = "%" + qDigits;
  // Search hits the fee row's own student name + enrolment, the imported
  // receipt numbers, plus the student master's reference code / phones — so
  // ops can paste whatever identifier the parent gave them, including a
  // receipt number off a screenshot.
  const searchFilter = q
    ? sql`(
        f.enrolment_number ILIKE ${like}
        OR f.raw->>'StudentName' ILIKE ${like}
        OR EXISTS (
          SELECT 1 FROM mcb_fee_transactions t
          WHERE t.enrolment_number = f.enrolment_number
            AND t.receipt_no ILIKE ${like}
        )
        OR EXISTS (
          SELECT 1 FROM mcb_students s
          WHERE s.enrolment_number = f.enrolment_number
            AND (
              s.student_name ILIKE ${like}
              OR (s.raw->>'StudentReferencesCode') ILIKE ${like}
              ${
                qDigits.length >= 4
                  ? sql`OR regexp_replace(coalesce(s.mobile_number, ''), '\\D', '', 'g') LIKE ${phoneSfx}
                        OR regexp_replace(coalesce(s.raw->>'FatherPhone', ''), '\\D', '', 'g') LIKE ${phoneSfx}
                        OR regexp_replace(coalesce(s.raw->>'MotherPhone', ''), '\\D', '', 'g') LIKE ${phoneSfx}`
                  : sql``
              }
            )
        )
      )`
    : sql`true`;

  const where = sql`${schoolFilter} AND ${ayFilter}
                    AND f.fee_head = ${head}
                    AND ${gradeFilter} AND ${searchFilter}`;

  // Per-student rollup. `balance > 0` is the pending test; a student who
  // has paid part of a multi-installment head shows as "partial".
  const perStudent = sql`
    WITH b AS (${base(where)}),
    agg AS (
      SELECT
        enrolment_number,
        max(student_name)                                  AS student_name,
        max(class_name)                                    AS class_name,
        max(section)                                       AS section,
        bool_or(has_left)                                  AS has_left,
        count(*)::int                                      AS installments,
        count(*) FILTER (WHERE paid > 0)::int              AS paid_installments,
        sum(gross)                                         AS gross,
        sum(concession)                                    AS concession,
        sum(paid)                                          AS paid,
        GREATEST(sum(gross) - sum(concession) - sum(paid), 0) AS balance,
        max(CASE WHEN paid > 0 THEN payment_date END)      AS last_paid_date,
        min(CASE WHEN paid > 0 THEN payment_date END)      AS first_paid_date,
        min(CASE WHEN gross - concession - paid > 0 THEN due_date END) AS next_due_date,
        jsonb_agg(
          jsonb_build_object(
            'installment', installment,
            'dueDate',     due_date,
            'gross',       gross,
            'concession',  concession,
            'paid',        paid,
            'balance',     GREATEST(gross - concession - paid, 0),
            'paidDate',    CASE WHEN paid > 0 THEN payment_date END,
            'receiptNo',   receipt_no,
            'status1',     status1
          ) ORDER BY due_date NULLS LAST, installment
        )                                                  AS installment_rows
      FROM b GROUP BY enrolment_number
    )
    SELECT a.*,
           s.raw->>'StudentReferencesCode' AS reference_code,
           coalesce(s.mobile_number, s.raw->>'FatherPhone', s.raw->>'MotherPhone') AS mobile,
           s.website_access
    FROM agg a
    LEFT JOIN mcb_students s ON s.enrolment_number = a.enrolment_number
  `;

  // Concession bands are a share of GROSS, not of the net the parent owes —
  // a 99% waiver is only visible against what was originally charged.
  /** Filename carries the filters — otherwise five different exports all
   *  land in Downloads as the same name. */
  const exportSlug = (kind: string) => {
    const parts = ["mcb", kind, scopeCode, head ?? "all", ay ?? "all-years"];
    if (status !== "all") parts.push(status);
    if (grade) parts.push(grade);
    if (q) parts.push("search");
    return parts.join("-").replace(/[^A-Za-z0-9-]+/g, "_");
  };

  const statusFilter =
    status === "paid"
      ? sql`balance <= 0`
      : status === "pending"
        ? sql`paid = 0 AND balance > 0`
        : status === "partial"
          ? sql`paid > 0 AND balance > 0`
          : status === "concession"
            ? sql`concession > 0`
            : status === "concession90"
              ? sql`gross > 0 AND concession / gross >= 0.9`
              : status === "concession50"
                ? sql`gross > 0 AND concession / gross >= 0.5 AND concession / gross < 0.9`
                : sql`true`;

  if (isExport && csvLevel === "receipts") {
    // Receipt lines for the students the filters selected, RESTRICTED TO THE
    // SELECTED FEE HEAD. Without that restriction this exported every fee
    // type those students ever paid — a "Tuition fee" export came out
    // carrying transport, admission and late fees too.
    const res = await db.execute(sql`
      WITH picked AS (
        SELECT * FROM (${perStudent}) t WHERE ${statusFilter} AND ${visibleFilter}
      )
      SELECT p.enrolment_number, p.student_name, p.class_name, p.section,
             t.receipt_no, t.paid_date, t.amount, t.payment_mode,
             t.fee_type, t.transaction_id, t.academic_year
      FROM picked p
      JOIN mcb_fee_transactions t ON t.enrolment_number = p.enrolment_number
      WHERE ${HEAD_OF_FEE_TYPE} = ${head}
        ${ay ? sql`AND t.academic_year = ${ay}` : sql``}
      ORDER BY p.student_name, t.paid_date DESC NULLS LAST, t.receipt_no
    `);
    const rows = rowsOf<Record<string, unknown>>(res).map((r) => [
      String(r.enrolment_number ?? ""),
      (r.student_name as string) ?? "",
      (r.class_name as string) ?? "",
      (r.section as string) ?? "",
      (r.receipt_no as string) ?? "",
      dateCell(r.paid_date),
      num2(r.amount),
      (r.payment_mode as string) ?? "",
      (r.fee_type as string) ?? "",
      (r.transaction_id as string) ?? "",
      (r.academic_year as string) ?? "",
    ]);
    const buf = workbook(
      "Receipts",
      ["Enrolment", "Student", "Class", "Section", "Receipt no", "Paid on",
       "Amount", "Mode", "Against", "MCB transaction", "Academic year"],
      rows,
      [6]
    );
    return xlsxResponse(buf, `${exportSlug("receipts")}.xlsx`);
  }

  if (isExport) {
    // Installment-level: one line per billed installment. `voucher_date` is
    // MCB's VoucherDate (when the receivable was raised), NOT a payment date
    // — the real payment dates are in the Receipts export.
    const res = await db.execute(sql`
      WITH b AS (${base(where)}),
      picked AS (
        SELECT * FROM (${perStudent}) t WHERE ${statusFilter} AND ${visibleFilter}
      )
      SELECT b.enrolment_number, b.student_name, b.class_name, b.section,
             b.fee_head, b.installment, b.due_date, b.gross, b.concession,
             (b.gross - b.concession)                       AS net,
             CASE WHEN b.gross > 0
                  THEN round(100 * b.concession / b.gross, 1) END AS concession_pct,
             b.paid,
             GREATEST(b.gross - b.concession - b.paid, 0)   AS balance,
             b.payment_date                                 AS voucher_date
      FROM b JOIN picked p ON p.enrolment_number = b.enrolment_number
      ORDER BY b.student_name, b.due_date NULLS LAST
    `);
    const rows = rowsOf<Record<string, unknown>>(res).map((r) => [
      String(r.enrolment_number ?? ""),
      (r.student_name as string) ?? "",
      (r.class_name as string) ?? "",
      (r.section as string) ?? "",
      (r.fee_head as string) ?? "",
      (r.installment as string) ?? "",
      dateCell(r.due_date),
      num2(r.gross),
      num2(r.concession),
      r.concession_pct == null ? "" : num2(r.concession_pct),
      num2(r.net),
      num2(r.paid),
      num2(r.balance),
      dateCell(r.voucher_date),
    ]);
    const buf = workbook(
      "Billing",
      ["Enrolment", "Student", "Class", "Section", "Fee head", "Installment",
       "Due date", "Billed (gross)", "Concession", "Concession %",
       "Net billed", "Paid", "Balance", "Voucher date"],
      rows,
      [7, 8, 10, 11, 12]
    );
    return xlsxResponse(buf, `${exportSlug("billing")}.xlsx`);
  }

  const [rows, totals, matched, grades] = await Promise.all([
    db.execute(sql`
      SELECT * FROM (${perStudent}) t
      WHERE ${statusFilter} AND ${visibleFilter}
      ORDER BY balance DESC, student_name
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `),
    // Summary tiles deliberately IGNORE the status chip: they are the
    // segment breakdown of this (school, head, year, grade, search) set, so
    // the chips read as slices of a stable total. Echoing the chip made the
    // tiles say "Yet to pay 0" while part-paid rows sat right below them.
    db.execute(sql`
      SELECT count(*) FILTER (WHERE ${visibleFilter})::int    AS students,
             count(*) FILTER (WHERE ${visibleFilter} AND balance <= 0)::int
                                                             AS paid_students,
             count(*) FILTER (WHERE ${visibleFilter} AND paid = 0 AND balance > 0)::int
                                                             AS pending_students,
             count(*) FILTER (WHERE ${visibleFilter} AND paid > 0 AND balance > 0)::int
                                                             AS partial_students,
             count(*) FILTER (WHERE ${visibleFilter} AND concession > 0)::int
                                                             AS concession_students,
             count(*) FILTER (WHERE ${visibleFilter} AND gross > 0
                                AND concession / gross >= 0.9)::int
                                                             AS concession90_students,
             count(*) FILTER (WHERE ${visibleFilter} AND gross > 0
                                AND concession / gross >= 0.5
                                AND concession / gross < 0.9)::int
                                                             AS concession50_students,
             sum(gross)                                      AS gross,
             sum(concession)                                 AS concession,
             sum(paid)                                       AS paid,
             sum(balance) FILTER (WHERE ${chaseable})        AS balance,
             count(*) FILTER (WHERE has_left)::int           AS left_students,
             sum(gross)    FILTER (WHERE has_left)           AS left_gross,
             sum(paid)     FILTER (WHERE has_left)           AS left_paid,
             sum(balance)  FILTER (WHERE has_left)           AS left_balance
      FROM (${perStudent}) t
    `),
    // Row count for pagination — this one DOES honour the chip.
    db.execute(
      sql`SELECT count(*)::int AS n FROM (${perStudent}) t
          WHERE ${statusFilter} AND ${visibleFilter}`
    ),
    // Grade chips for the current (school, head, ay) — unaffected by the
    // status/search filters so the list doesn't shrink under the user.
    db.execute(sql`
      SELECT DISTINCT f.raw->>'ClassName' AS class_name
      FROM mcb_fee_payments f
      WHERE ${schoolFilter} AND ${ayFilter} AND f.fee_head = ${head}
        AND f.raw->>'ClassName' IS NOT NULL
      ORDER BY 1
    `),
  ]);

  const t = rowsOf<Record<string, unknown>>(totals)[0] ?? {};
  const grossT = num(t.gross);
  const concT = num(t.concession);
  const matchedRows = num(rowsOf<{ n: number }>(matched)[0]?.n);

  return NextResponse.json({
    school: { code: scopeCode, name: scopeName },
    feeHead: head,
    page,
    pageSize: PAGE_SIZE,
    total: matchedRows,
    grades: rowsOf<{ class_name: string }>(grades).map((r) => r.class_name),
    totals: {
      students: num(t.students),
      paidStudents: num(t.paid_students),
      pendingStudents: num(t.pending_students),
      partialStudents: num(t.partial_students),
      concessionStudents: num(t.concession_students),
      concession90Students: num(t.concession90_students),
      concession50Students: num(t.concession50_students),
      gross: grossT,
      concession: concT,
      net: grossT - concT,
      paid: num(t.paid),
      balance: num(t.balance),
      /** Students who have left. Their billed/collected money is already
       *  inside the totals above; their balance is NOT, because it cannot
       *  be collected. Listed only when `inactive=1`. */
      leftStudents: num(t.left_students),
      leftGross: num(t.left_gross),
      leftPaid: num(t.left_paid),
      leftBalance: num(t.left_balance),
      showingLeft: includeInactive,
      /** False for a closed year, where the list already holds everyone. */
      enrolledOnly: currentYear,
    },
    rows: rowsOf<Record<string, unknown>>(rows).map((r) => {
      const gross = num(r.gross);
      const concession = num(r.concession);
      const paid = num(r.paid);
      const balance = num(r.balance);
      return {
        enrolment: String(r.enrolment_number),
        referenceCode: (r.reference_code as string | null) ?? null,
        name: (r.student_name as string | null) ?? null,
        grade: (r.class_name as string | null) ?? null,
        section: (r.section as string | null) ?? null,
        mobile: (r.mobile as string | null) ?? null,
        websiteAccess: r.website_access === true,
        hasLeft: r.has_left === true,
        installments: num(r.installments),
        paidInstallments: num(r.paid_installments),
        gross,
        concession,
        net: gross - concession,
        paid,
        balance,
        status: balance <= 0 ? "paid" : paid > 0 ? "partial" : "pending",
        firstPaidDate: (r.first_paid_date as string | null) ?? null,
        lastPaidDate: (r.last_paid_date as string | null) ?? null,
        nextDueDate: (r.next_due_date as string | null) ?? null,
        detail: (r.installment_rows as unknown[]) ?? [],
      };
    }),
  });
}
