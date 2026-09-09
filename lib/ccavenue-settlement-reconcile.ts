/**
 * Settlement-report reconciliation for CCAvenue.
 *
 * WHY THIS EXISTS (the 24-day blind spot):
 * CCAvenue's per-order Status API (`command=orderStatusTracker`, used by
 * app/api/cron/ccavenue-reconcile) is keyed on our order_id and returns ONLY
 * the LATEST transaction for that order. When a parent's SUCCESSFUL capture is
 * followed by an aborted retry (same order_id), that endpoint reports the
 * *aborted* attempt and the successful capture is invisible — so the order sat
 * `failed`/`pending` until a human noticed (SAL-ORD-2026-33890/33891, ₹2,000,
 * stuck 13-Jun → healed 7-Jul by hand).
 *
 * The ONLY channel that enumerates every transaction (including a success
 * hidden behind a later retry) is CCAvenue's Settlement / Transaction report.
 * This module ingests that report, finds every transaction CCAvenue considers
 * money-in-the-bank (Successful / Shipped / Captured / Settled), and heals any
 * local order still stuck — routed through the SAME `finalizeOrderPayment`
 * primitive the callback/status-poll paths use, so the group fan-out, sibling
 * payment rows, stock decrement, SMS, invoice and audit re-emit are identical.
 *
 * The report itself is fed in as text (CSV) by either:
 *   - scripts/ccavenue-settlement-reconcile.ts (ops runs on-demand / backlog),
 *   - app/api/cron/ccavenue-settlement-reconcile (daily, drains a drop dir).
 * Keeping the parser and reconciler pure (text in, report out) makes both
 * call sites — and the tests — trivial. Live report-API fetch can later be
 * plugged in as a third source that yields the same SettlementRow[].
 *
 * Not `server-only`: imported by the tsx CLI that runs outside Next.
 */
import { eq, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { mapCCAvenueStatus, type NormalizedGatewayResult } from "@/lib/ccavenue";
import { finalizeOrderPayment } from "@/lib/ccavenue-finalize";

/** One row of the CCAvenue settlement / transaction export, normalised. */
export type SettlementRow = {
  /** CCAvenue's "Order Id" — this is the value we sent at session-init, i.e.
   *  our orders.id UUID for the lead order of the basket. Some exports also
   *  carry the SAL-ORD merchant reference; we match on either. */
  orderId: string;
  /** CCAvenue reference_no for the transaction (the SUCCESSFUL one here). */
  referenceNo: string | null;
  /** Bank reference / RRN if the report carries it. */
  bankRef: string | null;
  /** Captured amount in rupees, as the report states it (basket total for a
   *  multi-order group). Parsed to a number for the amount-safety check. */
  amount: number | null;
  /** Raw status string from the report (e.g. "Successful" / "Captured"). */
  status: string;
  /** Free-text date string from the report, passed through to payments. */
  capturedAt: string | null;
  /** Payment mode/instrument if present. */
  paymentMode: string | null;
  /** SAL-ORD merchant reference when the export carries it separately from
   *  `orderId` (CCAvenue's real settlement layout puts our order UUID in
   *  "Order No." and the SAL-ORD number in "Merchant Param 1"). Used as a
   *  fallback lookup key so legacy rows that predate the UUID still resolve. */
  merchantOrderNumber: string | null;
  /** The entire parsed row, kept for forensic storage on payments.raw. */
  raw: Record<string, string>;
};

/** Per-row outcome of a reconcile pass. */
export type ReconcileOutcome = {
  orderId: string;
  referenceNo: string | null;
  reportStatus: string;
  /** What we decided to do with the row. */
  action:
    | "healed" // was stuck, flipped → paid (only when apply=true)
    | "would-heal" // dry-run: this row WOULD be healed
    | "already-paid" // local order already paid — nothing to do
    | "not-a-capture" // report status isn't a money-in state — ignored
    | "order-not-found" // no local order matches the report's order id
    | "amount-mismatch" // capture amount != local group total — NOT healed
    | "error"; // finalize threw
  orderNumber?: string;
  localGroupTotalRupees?: number;
  detail?: string;
};

export type ReconcileReport = {
  apply: boolean;
  totalRows: number;
  captureRows: number;
  healed: number;
  wouldHeal: number;
  alreadyPaid: number;
  notFound: number;
  amountMismatch: number;
  errors: number;
  outcomes: ReconcileOutcome[];
};

// ── CSV parsing ────────────────────────────────────────────────────────────

/** Split one CSV line honouring double-quoted fields (which may contain
 *  commas and escaped "" quotes). CCAvenue exports quote free-text columns. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Header aliases CCAvenue uses across its various export layouts. Matched
 *  case-insensitively after stripping non-alphanumerics, so "Order Id",
 *  "order_no", "OrderID" all collapse to the same key. */
const COLUMN_ALIASES: Record<keyof Omit<SettlementRow, "raw">, string[]> = {
  orderId: ["orderid", "orderno", "ordernumber", "merchantorderid", "orderidno"],
  referenceNo: ["referenceno", "reference", "trackingid", "ccavenuereferenceno"],
  bankRef: ["bankrefno", "bankreferenceno", "bankref", "rrn", "orderbankreferenceno"],
  // NB: deliberately NOT "settledamt"/"settlementamount" here — those are net
  // of PG fee + tax, and the amount gate compares against the gross basket
  // total. "Order Amt" / "Confirmed Amt" are the gross figures we want.
  amount: ["amount", "orderamount", "captureamount", "grossamount", "transactionamount", "orderamt", "confirmedamt", "capturedamt"],
  status: ["orderstatus", "status", "transactionstatus", "capturestatus", "transactiontype"],
  capturedAt: ["transactiondate", "orderdatetime", "capturedate", "date", "transdate"],
  paymentMode: ["paymentmode", "cardtype", "paymenttype", "mode", "instrument"],
  merchantOrderNumber: ["merchantparam1", "merchantorderno", "salordno"],
};

/** Settlement-type column (CR = credit/money-in, DR = debit/refund-out). Read
 *  separately from the alias table because it qualifies `status` rather than
 *  being a field in its own right. */
const SETTLEMENT_TYPE_ALIASES = ["settlementtype", "crdr", "drcr"];

/**
 * Collapse the settlement export's money-direction columns into a status
 * string `mapCCAvenueStatus` already understands.
 *
 * The settlement report has no "Order Status" column at all — money direction
 * lives in `Transaction Type` (CAPTURE / REFUND / CHARGEBACK) qualified by
 * `Settlement Type` (CR / DR). Only a CAPTURE that is also a credit is money
 * in the bank; everything else (refunds, chargebacks, any debit) is passed
 * through verbatim so it maps to "unknown" → `not-a-capture` and is ignored.
 * Reports that DO carry a real status column are left untouched.
 */
function normalizeSettlementStatus(
  rawStatus: string,
  settlementType: string | null
): string {
  const txn = (rawStatus || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const dir = (settlementType || "").trim().toUpperCase();
  if (txn === "capture" || txn === "sale" || txn === "purchase") {
    // A capture settled as a debit is not money in — refuse to normalise it.
    return dir === "DR" ? rawStatus : "Successful";
  }
  return rawStatus;
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Parse a CCAvenue settlement/transaction CSV into normalised rows. Tolerant
 * of column ordering and label variants; unknown columns are preserved in
 * `raw`. Throws only when no recognisable order-id column is present (a strong
 * signal the wrong file was fed in).
 */
export function parseSettlementCsv(text: string): SettlementRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  return rowsFromMatrix(lines.map(splitCsvLine));
}

/**
 * Core parser: takes a rectangular cell matrix (from CSV or a spreadsheet
 * sheet) and yields normalised rows.
 *
 * The header row is *located*, not assumed to be row 0 — CCAvenue's xlsx
 * export puts a payout summary above the transaction table, so the real
 * header sits several rows down. Any row containing a recognisable order-id
 * column is treated as the header; everything above it is preamble.
 */
function rowsFromMatrix(matrix: string[][]): SettlementRow[] {
  const headerIdx = matrix.findIndex((r) =>
    r.some((c) => COLUMN_ALIASES.orderId.includes(normKey(c)))
  );
  if (headerIdx < 0) {
    throw new Error(
      `parseSettlement: no order-id column found. First row was: ${(matrix[0] ?? []).join(", ")}`
    );
  }

  const headers = matrix[headerIdx];
  const normHeaders = headers.map(normKey);
  const lines = matrix.slice(headerIdx);

  // Resolve each logical field to a column index via the alias table.
  const idx: Partial<Record<keyof Omit<SettlementRow, "raw">, number>> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [
    keyof Omit<SettlementRow, "raw">,
    string[],
  ][]) {
    const found = normHeaders.findIndex((h) => aliases.includes(h));
    if (found >= 0) idx[field] = found;
  }
  const settlementTypeIdx = normHeaders.findIndex((h) =>
    SETTLEMENT_TYPE_ALIASES.includes(h)
  );

  const rows: SettlementRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i];
    const raw: Record<string, string> = {};
    headers.forEach((h, c) => (raw[h] = cells[c] ?? ""));

    const at = (f: keyof Omit<SettlementRow, "raw">): string | null => {
      const c = idx[f];
      if (c === undefined) return null;
      const v = (cells[c] ?? "").trim();
      return v === "" ? null : v;
    };

    const orderId = at("orderId");
    if (!orderId) continue; // skip footer/summary lines with no order id

    const amountStr = at("amount");
    const amount =
      amountStr != null
        ? Number(amountStr.replace(/[^0-9.-]/g, "")) || null
        : null;

    const settlementType =
      settlementTypeIdx >= 0 ? (cells[settlementTypeIdx] ?? "").trim() : null;

    rows.push({
      orderId,
      referenceNo: at("referenceNo"),
      bankRef: at("bankRef"),
      amount,
      status: normalizeSettlementStatus(at("status") ?? "", settlementType),
      capturedAt: at("capturedAt"),
      paymentMode: at("paymentMode"),
      merchantOrderNumber: at("merchantOrderNumber"),
      raw,
    });
  }
  return rows;
}

/**
 * Parse CCAvenue's real settlement export (.xlsx). The workbook carries a
 * payout summary and a payout-details sheet ahead of the transaction sheet,
 * so every sheet is tried and the first one containing a recognisable
 * transaction table wins.
 *
 * Cells are read formatted-as-text (`raw: false`) so amounts and datetimes
 * arrive as the strings the rest of the parser expects rather than as floats
 * and Excel serial numbers.
 */
export function parseSettlementWorkbook(buf: Buffer): SettlementRow[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    const hasTable = matrix.some((r) =>
      (r ?? []).some((c) => COLUMN_ALIASES.orderId.includes(normKey(String(c ?? ""))))
    );
    if (!hasTable) continue;
    return rowsFromMatrix(matrix.map((r) => (r ?? []).map((c) => String(c ?? ""))));
  }
  throw new Error(
    `parseSettlementWorkbook: no transaction sheet found. Sheets were: ${wb.SheetNames.join(", ")}`
  );
}

// ── Reconciliation ───────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LocalOrder = {
  id: string;
  orderNumber: string;
  orderGroupId: string | null;
  paymentStatus: string;
  groupTotalPaise: number;
};

/** Resolve a report's order id (UUID we sent, or SAL-ORD number) to the local
 *  order plus its whole-basket total (so the amount check compares like-for-
 *  like against a group capture). Returns null if nothing matches. */
async function resolveLocalOrder(
  orderIdOrNumber: string,
  fallbackOrderNumber?: string | null
): Promise<LocalOrder | null> {
  const lookup = async (key: string) => {
    const byId = UUID_RE.test(key);
    const [r] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        orderGroupId: orders.orderGroupId,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(byId ? eq(orders.id, key) : eq(orders.orderNumber, key))
      .limit(1);
    return r ?? null;
  };

  // Primary key is CCAvenue's "Order No." (our UUID). Older baskets predate
  // the UUID hand-off and only carry the SAL-ORD number in Merchant Param 1.
  let row = await lookup(orderIdOrNumber);
  if (!row && fallbackOrderNumber) row = await lookup(fallbackOrderNumber);
  if (!row) return null;

  // Whole-basket total: sum of every sibling sharing the group id, else this
  // order's own total. CCAvenue captures the basket total as one amount.
  let groupTotalPaise: number;
  if (row.orderGroupId) {
    const [agg] = await db
      .select({ total: sql<number>`coalesce(sum(${orders.total}), 0)` })
      .from(orders)
      .where(eq(orders.orderGroupId, row.orderGroupId));
    groupTotalPaise = Number(agg?.total ?? 0);
  } else {
    const [self] = await db
      .select({ total: orders.total })
      .from(orders)
      .where(eq(orders.id, row.id))
      .limit(1);
    groupTotalPaise = Number(self?.total ?? 0);
  }

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    orderGroupId: row.orderGroupId,
    paymentStatus: row.paymentStatus,
    groupTotalPaise,
  };
}

/**
 * Reconcile a batch of settlement rows against local order state.
 *
 * For every row CCAvenue reports as a money-in state, we heal the matching
 * local order iff it isn't already paid AND the captured amount matches the
 * local group total (a hard safety gate — we never flip an order to paid on
 * an amount we can't reconcile). Healing is delegated to finalizeOrderPayment,
 * which owns all the paid-path side effects and is idempotent.
 *
 * `apply=false` (default) is a dry run: it reports exactly what it WOULD heal
 * without mutating anything — always run this first against a fresh export.
 */
export async function reconcileSettlement(
  rows: SettlementRow[],
  opts: { apply?: boolean; amountToleranceRupees?: number } = {}
): Promise<ReconcileReport> {
  const apply = opts.apply ?? false;
  const tol = opts.amountToleranceRupees ?? 1; // ₹1 rounding slack
  const outcomes: ReconcileOutcome[] = [];
  let captureRows = 0;

  for (const row of rows) {
    const mapped = mapCCAvenueStatus(row.status);
    if (mapped !== "paid") {
      outcomes.push({
        orderId: row.orderId,
        referenceNo: row.referenceNo,
        reportStatus: row.status,
        action: "not-a-capture",
      });
      continue;
    }
    captureRows++;

    const local = await resolveLocalOrder(row.orderId, row.merchantOrderNumber);
    if (!local) {
      outcomes.push({
        orderId: row.orderId,
        referenceNo: row.referenceNo,
        reportStatus: row.status,
        action: "order-not-found",
      });
      continue;
    }

    const groupTotalRupees = Math.round(local.groupTotalPaise / 100);
    const base: ReconcileOutcome = {
      orderId: row.orderId,
      referenceNo: row.referenceNo,
      reportStatus: row.status,
      orderNumber: local.orderNumber,
      localGroupTotalRupees: groupTotalRupees,
      action: "would-heal",
    };

    if (local.paymentStatus === "paid" || local.paymentStatus === "refunded") {
      outcomes.push({ ...base, action: "already-paid" });
      continue;
    }

    // Amount safety gate: only heal when the capture reconciles to the basket.
    if (
      row.amount != null &&
      Math.abs(row.amount - groupTotalRupees) > tol
    ) {
      outcomes.push({
        ...base,
        action: "amount-mismatch",
        detail: `report ₹${row.amount} vs local group ₹${groupTotalRupees}`,
      });
      continue;
    }

    if (!apply) {
      outcomes.push({ ...base, action: "would-heal" });
      continue;
    }

    const normalized: NormalizedGatewayResult = {
      status: "paid",
      trackingId: row.referenceNo,
      bankRef: row.bankRef,
      paidAmount: row.amount != null ? row.amount.toFixed(2) : null,
      paymentDate: row.capturedAt,
      paymentMode: row.paymentMode,
      rawStatus: row.status,
      rawResponse: {
        settlementReconcile: true,
        ...row.raw,
      },
    };

    try {
      const res = await finalizeOrderPayment({
        orderId: local.id,
        source: "settlement-reconcile",
        normalized,
      });
      if (res.kind === "marked-paid") {
        outcomes.push({ ...base, action: "healed" });
      } else if (res.kind === "no-change" && res.paymentStatus === "paid") {
        // Raced another finalize caller to paid — treat as already-paid.
        outcomes.push({ ...base, action: "already-paid" });
      } else {
        outcomes.push({
          ...base,
          action: "error",
          detail: `finalize returned ${res.kind}/${"reason" in res ? res.reason : ""}`,
        });
      }
    } catch (e) {
      outcomes.push({
        ...base,
        action: "error",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const count = (a: ReconcileOutcome["action"]) =>
    outcomes.filter((o) => o.action === a).length;

  return {
    apply,
    totalRows: rows.length,
    captureRows,
    healed: count("healed"),
    wouldHeal: count("would-heal"),
    alreadyPaid: count("already-paid"),
    notFound: count("order-not-found"),
    amountMismatch: count("amount-mismatch"),
    errors: count("error"),
    outcomes,
  };
}

/** Convenience: parse + reconcile in one call. */
export async function reconcileSettlementCsv(
  csv: string,
  opts: { apply?: boolean; amountToleranceRupees?: number } = {}
): Promise<ReconcileReport> {
  return reconcileSettlement(parseSettlementCsv(csv), opts);
}

/** Convenience: parse + reconcile an .xlsx settlement export in one call. */
export async function reconcileSettlementWorkbook(
  buf: Buffer,
  opts: { apply?: boolean; amountToleranceRupees?: number } = {}
): Promise<ReconcileReport> {
  return reconcileSettlement(parseSettlementWorkbook(buf), opts);
}
