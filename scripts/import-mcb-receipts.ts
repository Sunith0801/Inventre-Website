/**
 * Nightly MyClassBoard *receipt* import.
 *
 * Why this exists separately from import-from-mcb.ts: that script pulls
 * GET_StudentFeeReceivables_Tally, which is billing, not payment. It carries
 * no receipt number (`receipt_no` there is MCB's internal
 * FeeInstallmentStudentID) and no real payment date (`payment_date` there is
 * the VoucherDate — the day the receivable was raised). The only endpoint
 * that returns genuine receipts is GET_StudentFee_Transactions, and it is
 * keyed per student: MCB publishes no branch-wide bulk variant
 * (GET_TallyFeePayments returns accounting journal lines,
 * GetStudentFeeTransactionsAll_App returns mode-wise totals).
 *
 * So: one call per (student, academic year), ~25k calls for a cold backfill.
 * That is the whole reason this is a resumable, incremental job rather than
 * a table join.
 *
 * Env (from .env.deploy):
 *   MCB_API_BASE   default https://api.myclassboard.com
 *   MCB_API_KEY    required (api_key header)
 *   MCB_TOKEN_ID   required (TokenID query param)
 *   DATABASE_URL   required
 *
 * Usage:
 *   tsx scripts/import-mcb-receipts.ts                  # incremental (nightly)
 *   tsx scripts/import-mcb-receipts.ts --full           # every student, ignore sync state
 *   tsx scripts/import-mcb-receipts.ts --limit=500      # cap this run (backfill in slices)
 *   tsx scripts/import-mcb-receipts.ts --stale-days=7   # re-fetch anything older than N days
 *   tsx scripts/import-mcb-receipts.ts --enrolment=24KS0032   # one student, for debugging
 *   tsx scripts/import-mcb-receipts.ts --dry-run
 */
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const MCB_API_BASE = process.env.MCB_API_BASE || "https://api.myclassboard.com";
const MCB_API_KEY = process.env.MCB_API_KEY || "";
const MCB_TOKEN_ID = process.env.MCB_TOKEN_ID || "";

const flag = (name: string) => process.argv.includes(`--${name}`);
const flagValue = (name: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const FULL = flag("full");
const DRY = flag("dry-run");
const ONE = flagValue("enrolment");
const LIMIT = Number(flagValue("limit") ?? "0") || 0;
/** A student already fetched is re-checked only if their receivables moved,
 *  or if this many days have passed — the safety net for receipts MCB
 *  back-stamps onto an older date. */
const STALE_DAYS = Number(flagValue("stale-days") ?? "10") || 10;

/** MCB tolerates this comfortably; 12 was enough to trip intermittent 500s. */
const CONCURRENCY = Number(flagValue("concurrency") ?? "6") || 6;
const TIMEOUT_MS = 30_000;
const RETRIES = 2;

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function parseMcbDate(v: unknown): string | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (m) {
    const mm = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  return null;
}
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown): number => numOrNull(v) ?? 0;

function unwrap(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    for (const k of ["data", "Data", "Result", "result", "Table", "Records"]) {
      const v = (payload as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchTransactions(
  branchId: number,
  ayId: number,
  studentId: number
): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams({
    TokenID: MCB_TOKEN_ID,
    AcademicYearID: String(ayId),
    ClassID: "0", // student id already pins the row; 0 = any class
    BranchID: String(branchId),
    StudentEnrollmentID: String(studentId),
  });
  const url = `${MCB_API_BASE}/api/StudentFeeData/GET_StudentFee_Transactions?${qs}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: "application/json", api_key: MCB_API_KEY },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`MCB ${r.status}`);
      return unwrap(await r.json());
    } catch (e) {
      lastErr = e;
      // Linear backoff — MCB rate-limits by shedding, so easing off works
      // better here than hammering with an immediate retry.
      if (attempt < RETRIES) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("MCB unreachable");
}

/** Stable identity for a receipted fee line. MCB gives no row id, and
 *  (receipt, fee type) collides across occurrences of the same head. */
function txnKey(enrolment: string, ayId: number, t: Record<string, unknown>): string {
  return [
    enrolment,
    ayId,
    String(t.ReceiptNo ?? ""),
    String(t.FeeAccountID ?? ""),
    String(t.OccuranceID ?? ""),
    String(t.FeeType ?? ""),
    parseMcbDate(t.PaidDate ?? t.CreatedDate) ?? "",
    String(num(t.PaidAmmount ?? t.PaidAmount)),
  ].join("|");
}

type Target = {
  enrolment_number: string;
  student_id: number;
  branch_id: number;
  ay_id: number;
  academic_year: string | null;
};

async function main() {
  const startedAt = Date.now();
  console.log(`[mcb-receipts] start ${new Date().toISOString()}`);

  if (!MCB_API_KEY || !MCB_TOKEN_ID) {
    console.error("[mcb-receipts] MCB_API_KEY / MCB_TOKEN_ID not set");
    process.exit(1);
  }
  const dsn = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL;
  if (!dsn) {
    console.error("[mcb-receipts] DATABASE_URL not set");
    process.exit(1);
  }
  const sql = postgres(dsn, { max: 4, prepare: false });

  // The work-list comes from the receivables table, which already holds every
  // student's MCB identity triple. A student with no receivable row cannot
  // have a receipt either, so nothing is missed by starting here.
  const targets: Target[] = await sql<Target[]>`
    SELECT DISTINCT ON (f.enrolment_number, ay_id)
      f.enrolment_number,
      (f.raw->>'StudentEnrollmentID')::int AS student_id,
      (f.raw->>'BranchID')::int            AS branch_id,
      (f.raw->>'AcademicYearID')::int      AS ay_id,
      f.raw->>'AcademicYear'               AS academic_year,
      max(f.synced_at)     OVER (PARTITION BY f.enrolment_number) AS receivable_synced_at
    FROM mcb_fee_payments f
    WHERE f.raw->>'StudentEnrollmentID' ~ '^[0-9]+$'
      AND f.raw->>'BranchID' ~ '^[0-9]+$'
      AND f.raw->>'AcademicYearID' ~ '^[0-9]+$'
      ${ONE ? sql`AND f.enrolment_number = ${ONE}` : sql``}
    ORDER BY f.enrolment_number, ay_id, f.synced_at DESC
  `;

  // Incremental rule: fetch a (student, year) if we have never fetched it,
  // if the last fetch failed, if their receivables were re-synced after our
  // last fetch (money may have moved), or if the fetch has simply gone stale.
  let work: Target[] = targets;
  if (!FULL && !ONE) {
    const state = await sql<
      { enrolment_number: string; academic_year_id: number; fetched_at: Date; ok: boolean }[]
    >`SELECT enrolment_number, academic_year_id, fetched_at, ok FROM mcb_fee_txn_sync`;
    const seen = new Map(
      state.map((s) => [`${s.enrolment_number}|${s.academic_year_id}`, s])
    );
    const receivableSync = await sql<{ enrolment_number: string; last: Date }[]>`
      SELECT enrolment_number, max(synced_at) AS last
      FROM mcb_fee_payments GROUP BY enrolment_number
    `;
    const lastReceivable = new Map(receivableSync.map((r) => [r.enrolment_number, r.last]));
    const staleBefore = Date.now() - STALE_DAYS * 86_400_000;
    work = targets.filter((t) => {
      const s = seen.get(`${t.enrolment_number}|${t.ay_id}`);
      if (!s || !s.ok) return true;
      const fetchedAt = new Date(s.fetched_at).getTime();
      if (fetchedAt < staleBefore) return true;
      const rec = lastReceivable.get(t.enrolment_number);
      return rec ? new Date(rec).getTime() > fetchedAt : false;
    });
  }
  if (LIMIT > 0 && work.length > LIMIT) work = work.slice(0, LIMIT);

  console.log(
    `[mcb-receipts] ${targets.length} (student × year) known, ${work.length} to fetch` +
      `${FULL ? " (--full)" : ""}${LIMIT ? ` (--limit=${LIMIT})` : ""}${DRY ? " (dry-run)" : ""}`
  );
  if (DRY || work.length === 0) {
    await sql.end({ timeout: 5 });
    console.log(`[mcb-receipts] nothing written`);
    return;
  }

  let done = 0;
  let rowsWritten = 0;
  let rowsDeleted = 0;
  let failed = 0;
  let noReceipts = 0;

  // Hand-rolled worker pool: the array is up to 25k long, so a
  // Promise.all(map) would open every socket at once.
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= work.length) return;
      const t = work[i];
      try {
        const rows = await fetchTransactions(t.branch_id, t.ay_id, t.student_id);
        const byKey = new Map<string, Record<string, unknown>>();
        for (const r of rows) byKey.set(txnKey(t.enrolment_number, t.ay_id, r), r);

        const records = [...byKey.entries()].map(([key, r]) => ({
          txn_key: key,
          enrolment_number: t.enrolment_number,
          receipt_no: String(r.ReceiptNo ?? ""),
          paid_date: parseMcbDate(r.PaidDate ?? r.CreatedDate),
          amount: num(r.PaidAmmount ?? r.PaidAmount),
          fee_type: (r.FeeType as string | null) ?? null,
          payment_mode: (r.PaymentMode as string | null) ?? null,
          payment_mode_id: numOrNull(r.PaymentModeID),
          transaction_id: (r.MCBTransactionID as string | null) ?? null,
          is_online: num(r.IsOnlineReceipt) === 1,
          academic_year: (r.AcademicYear as string | null) ?? t.academic_year,
          branch_id: t.branch_id,
          student_id: t.student_id,
          fee_account_id: numOrNull(r.FeeAccountID),
          occurrence_id: numOrNull(r.OccuranceID),
          raw: r,
        }));

        await sql.begin(async (tx) => {
          if (records.length > 0) {
            await tx`
              INSERT INTO mcb_fee_transactions ${tx(
                records,
                "txn_key", "enrolment_number", "receipt_no", "paid_date", "amount",
                "fee_type", "payment_mode", "payment_mode_id", "transaction_id",
                "is_online", "academic_year", "branch_id", "student_id",
                "fee_account_id", "occurrence_id", "raw"
              )}
              ON CONFLICT (txn_key) DO UPDATE SET
                receipt_no      = EXCLUDED.receipt_no,
                paid_date       = EXCLUDED.paid_date,
                amount          = EXCLUDED.amount,
                fee_type        = EXCLUDED.fee_type,
                payment_mode    = EXCLUDED.payment_mode,
                payment_mode_id = EXCLUDED.payment_mode_id,
                transaction_id  = EXCLUDED.transaction_id,
                is_online       = EXCLUDED.is_online,
                academic_year   = EXCLUDED.academic_year,
                raw             = EXCLUDED.raw,
                synced_at       = now()
            `;
          }
          // A cancelled or re-issued receipt disappears upstream; scope the
          // delete to this (student, year) so we never touch another year.
          const gone = await tx`
            DELETE FROM mcb_fee_transactions
            WHERE enrolment_number = ${t.enrolment_number}
              AND branch_id = ${t.branch_id}
              AND txn_key LIKE ${`${t.enrolment_number}|${t.ay_id}|%`}
              ${
                records.length
                  ? tx`AND txn_key <> ALL(${records.map((r) => r.txn_key)})`
                  : tx``
              }
            RETURNING 1
          `;
          rowsDeleted += gone.length;
          await tx`
            INSERT INTO mcb_fee_txn_sync
              (enrolment_number, academic_year_id, fetched_at, rows_seen, ok, error)
            VALUES (${t.enrolment_number}, ${t.ay_id}, now(), ${records.length}, true, NULL)
            ON CONFLICT (enrolment_number, academic_year_id) DO UPDATE SET
              fetched_at = now(), rows_seen = EXCLUDED.rows_seen, ok = true, error = NULL
          `;
        });

        rowsWritten += records.length;
        if (records.length === 0) noReceipts++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        await sql`
          INSERT INTO mcb_fee_txn_sync
            (enrolment_number, academic_year_id, fetched_at, rows_seen, ok, error)
          VALUES (${t.enrolment_number}, ${t.ay_id}, now(), 0, false, ${msg.slice(0, 300)})
          ON CONFLICT (enrolment_number, academic_year_id) DO UPDATE SET
            fetched_at = now(), ok = false, error = EXCLUDED.error
        `.catch(() => {});
      }
      done++;
      if (done % 250 === 0) {
        console.log(
          `[mcb-receipts] ${done}/${work.length} · rows=${rowsWritten} ` +
            `empty=${noReceipts} failed=${failed}`
        );
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const [{ total }] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM mcb_fee_transactions
  `;
  console.log(
    `[mcb-receipts] done in ${Math.round((Date.now() - startedAt) / 1000)}s · ` +
      `fetched=${done} rowsUpserted=${rowsWritten} rowsDeleted=${rowsDeleted} ` +
      `studentsWithNoReceipts=${noReceipts} failed=${failed} tableTotal=${total}`
  );
  if (failed > 0) {
    console.warn(
      `[mcb-receipts] WARN: ${failed} (student × year) fetches failed — they stay ` +
        `ok=false in mcb_fee_txn_sync and are retried on the next run.`
    );
  }
  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.error("[mcb-receipts] fatal:", e);
  process.exit(1);
});
