import { db } from "@/db/client";
import { sql } from "drizzle-orm";

/**
 * Receipt lookup for one student, stored-first with a live MCB fallback.
 *
 * Shared by the ledger's receipts panel (app/api/admin/mcb/fees/receipts)
 * and the printable receipt document (app/fees/receipt/[receiptNo]). They
 * MUST agree: while the cold backfill is still working through 23k
 * (student × year) pairs, the panel would happily show a live receipt that
 * the document then reported as "not found" — which is exactly what
 * happened to I1149 / 23WMJK0403 on 2026-08-27.
 *
 * Background on why receipts are a separate lookup at all — the receivables
 * feed carries no receipt number and no payment date — is in
 * scripts/import-mcb-receipts.ts.
 */

const MCB_API_BASE = process.env.MCB_API_BASE || "https://api.myclassboard.com";
const MCB_API_KEY = process.env.MCB_API_KEY || "";
const MCB_TOKEN_ID = process.env.MCB_TOKEN_ID || "";

const UPSTREAM_TIMEOUT_MS = 20_000;

export type Receipt = {
  receiptNo: string | null;
  paidDate: string | null;
  amount: number;
  mode: string | null;
  feeType: string | null;
  transactionId: string | null;
  isOnline: boolean;
  academicYear: string | null;
  /** Present on live results only; the importer stores these as columns. */
  branchId?: number | null;
};

export type ReceiptLookup = {
  receipts: Receipt[];
  source: "stored" | "live";
  errors?: string[];
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
/** MCB dates arrive as "08 Feb 2026" here and "2026-08-04T00:00:00" elsewhere. */
export function parseMcbDate(v: unknown): string | null {
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
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}
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

/** Ops re-open the same student repeatedly while working a chase list. */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: ReceiptLookup }>();

export function mcbConfigured() {
  return Boolean(MCB_API_KEY && MCB_TOKEN_ID);
}

export async function lookupReceipts(
  enrolment: string,
  ay: string | null = null
): Promise<ReceiptLookup> {
  // ── stored copy first ──────────────────────────────────────────────
  const storedRes = await db.execute(sql`
    SELECT t.receipt_no, t.paid_date, t.amount, t.payment_mode, t.fee_type,
           t.transaction_id, t.is_online, t.academic_year, t.branch_id
    FROM mcb_fee_transactions t
    WHERE t.enrolment_number = ${enrolment}
      AND ${ay ? sql`t.academic_year = ${ay}` : sql`true`}
    ORDER BY t.paid_date DESC NULLS LAST, t.receipt_no
  `);
  const stored = rowsOf<Record<string, unknown>>(storedRes);
  // "Synced but genuinely has no receipts" must not fall through to a live
  // call every time — that is exactly what the sync table records.
  const syncedRes = await db.execute(sql`
    SELECT count(*)::int AS n FROM mcb_fee_txn_sync
    WHERE enrolment_number = ${enrolment} AND ok
  `);
  const isSynced = num(rowsOf<{ n: number }>(syncedRes)[0]?.n) > 0;
  if (stored.length > 0 || isSynced) {
    return {
      source: "stored",
      receipts: stored.map((r) => ({
        receiptNo: (r.receipt_no as string) || null,
        paidDate: r.paid_date ? String(r.paid_date).slice(0, 10) : null,
        amount: num(r.amount),
        mode: (r.payment_mode as string | null) ?? null,
        feeType: (r.fee_type as string | null) ?? null,
        transactionId: (r.transaction_id as string | null) ?? null,
        isOnline: r.is_online === true,
        academicYear: (r.academic_year as string | null) ?? null,
        branchId: r.branch_id == null ? null : Number(r.branch_id),
      })),
    };
  }

  if (!mcbConfigured()) {
    return { source: "live", receipts: [], errors: ["MCB credentials are not configured"] };
  }

  const cacheKey = `${enrolment}|${ay ?? "all"}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  // MCB keys transactions by (branch, academic year, student *id*) — none of
  // which the caller knows. Recover them from the student's receivable rows.
  const idRes = await db.execute(sql`
    SELECT DISTINCT
      f.raw->>'StudentEnrollmentID' AS student_id,
      f.raw->>'BranchID'            AS branch_id,
      f.raw->>'AcademicYearID'      AS ay_id,
      f.raw->>'AcademicYear'        AS ay
    FROM mcb_fee_payments f
    WHERE f.enrolment_number = ${enrolment}
      AND ${ay ? sql`f.raw->>'AcademicYear' = ${ay}` : sql`true`}
      AND f.raw->>'StudentEnrollmentID' IS NOT NULL
  `);
  const keys = rowsOf<Record<string, string | null>>(idRes).filter(
    (k) => k.student_id && k.branch_id && k.ay_id
  );
  if (keys.length === 0) {
    return { source: "live", receipts: [], errors: ["no MCB identity on file"] };
  }

  const receipts: Receipt[] = [];
  const errors: string[] = [];
  await Promise.all(
    keys.map(async (k) => {
      const qs = new URLSearchParams({
        TokenID: MCB_TOKEN_ID,
        AcademicYearID: String(k.ay_id),
        // MCB accepts 0 as "any class"; the student id already pins the row.
        ClassID: "0",
        BranchID: String(k.branch_id),
        StudentEnrollmentID: String(k.student_id),
      });
      const url = `${MCB_API_BASE}/api/StudentFeeData/GET_StudentFee_Transactions?${qs}`;
      try {
        const r = await fetch(url, {
          headers: { Accept: "application/json", api_key: MCB_API_KEY },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          cache: "no-store",
        });
        if (!r.ok) {
          errors.push(`MCB ${r.status} for AY ${k.ay ?? k.ay_id}`);
          return;
        }
        for (const t of unwrap(await r.json())) {
          receipts.push({
            receiptNo: (t.ReceiptNo as string | null) || null,
            paidDate: parseMcbDate(t.PaidDate ?? t.CreatedDate),
            // MCB's own spelling.
            amount: num(t.PaidAmmount ?? t.PaidAmount ?? t.InstallmentAmount),
            mode: (t.PaymentMode as string | null) || null,
            feeType: (t.FeeType as string | null) || null,
            transactionId: (t.MCBTransactionID as string | null) || null,
            isOnline: num(t.IsOnlineReceipt) === 1,
            academicYear: (t.AcademicYear as string | null) ?? k.ay ?? null,
            branchId: Number(k.branch_id),
          });
        }
      } catch (e) {
        errors.push(
          e instanceof Error && e.name === "TimeoutError"
            ? `MCB timed out for AY ${k.ay ?? k.ay_id}`
            : `MCB unreachable for AY ${k.ay ?? k.ay_id}`
        );
      }
    })
  );

  // One receipt covers several fee lines, so the same number repeats; keep
  // every line but collapse exact duplicates from overlapping keys.
  const seen = new Set<string>();
  const deduped = receipts.filter((x) => {
    const k = `${x.receiptNo}|${x.feeType}|${x.amount}|${x.paidDate}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  deduped.sort((a, b) => (b.paidDate ?? "").localeCompare(a.paidDate ?? ""));

  const value: ReceiptLookup = {
    source: "live",
    receipts: deduped,
    errors: errors.length ? errors : undefined,
  };
  if (deduped.length > 0 || errors.length === 0) {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(cacheKey, { at: Date.now(), value });
  }
  return value;
}
