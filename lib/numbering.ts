import "server-only";
import { sql, and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { numberingCounters } from "@/db/schema";

/**
 * Allocate the next sequence number atomically for a (prefix, period) pair.
 *
 * Implementation: a single `INSERT … ON CONFLICT DO UPDATE … RETURNING value`
 * statement. Postgres serializes concurrent UPSERTs on the (prefix, period)
 * primary key, so two callers can't read the same value. There's no row-level
 * lock held across application code, and no COUNT(*) hot-spot as the table grows.
 *
 * @param prefix  short tag like "INV", "ORD", "RTN", "CUST", "SHP"
 * @param period  partition key — typically a year ("2026") or financial year ("26-27")
 * @returns       the freshly allocated integer (1, 2, 3, …)
 */
export async function nextNumber(
  prefix: string,
  period: string
): Promise<number> {
  const [row] = await db
    .insert(numberingCounters)
    .values({ prefix, period, value: 1 })
    .onConflictDoUpdate({
      target: [numberingCounters.prefix, numberingCounters.period],
      set: {
        value: sql`${numberingCounters.value} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ value: numberingCounters.value });
  return row.value;
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** India financial year ("26-27") starting April 1. */
export function financialYear(date: Date = new Date()): string {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  if (m >= 4) return `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`;
  return `${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;
}

/**
 * Find the latest `SAL-ORD-{YYYY}-{seq}` already in use across both the
 * ERP mirror and the local orders table, and return its `{YYYY}` year +
 * the integer sequence. The seq is a single global counter (e.g. 27080),
 * not `{yearTail}{3digit}` — so the row with MAX(seq) is the row to
 * continue from, regardless of which year prefix it carries.
 */
async function latestSalOrd(): Promise<{ year: string; maxSeq: number } | null> {
  const r = await db.execute(sql`
    WITH all_so AS (
      SELECT erp_name AS name FROM erp.sales_orders
        WHERE erp_name ~ '^SAL-ORD-[0-9]{4}-[0-9]+$'
      UNION ALL
      SELECT order_number AS name FROM orders
        WHERE order_number ~ '^SAL-ORD-[0-9]{4}-[0-9]+$'
    ),
    parsed AS (
      SELECT substring(name from '^SAL-ORD-([0-9]{4})-') AS yr,
             (substring(name from '^SAL-ORD-[0-9]{4}-([0-9]+)$'))::bigint AS seq
      FROM all_so
    )
    SELECT yr, seq FROM parsed ORDER BY seq DESC LIMIT 1
  `);
  const row = (r as unknown as { yr: string; seq: number | string }[])[0];
  if (!row) return null;
  return { year: row.yr, maxSeq: Number(row.seq) };
}

// ── Concrete allocators ───────────────────────────────────────────────

/**
 * Re-seed window: trust the counter without re-running the expensive
 * `latestSalOrd()` cross-table scan if it was touched within this many
 * seconds. `nextNumber()` (called below) updates `updated_at` on every
 * allocation, so under any active traffic the counter is permanently
 * "fresh" and we skip the slow path entirely. We only re-seed during
 * idle gaps when ERP might have advanced its own numbering behind our
 * back (the local mirror is updated by the ERP poll every 60s).
 *
 * Profile (2026-05-26): the seed query EXPLAIN'd at 4.7s execution time
 * because it does substring/regex eval on ~32k rows from
 * orders + erp.sales_orders. With this guard, the slow path runs at
 * most once per 60s during active hours instead of once per checkout.
 */
const RESEED_AFTER_SECONDS = 60;

export async function allocOrderNumber(date: Date = new Date()): Promise<string> {
  const fallbackYear = String(date.getFullYear());

  // Check counter freshness FIRST. If it was bumped recently by a prior
  // allocation, we already know the highest number we've handed out and
  // skip the cross-table scan.
  const [existing] = await db
    .select({
      value: numberingCounters.value,
      period: numberingCounters.period,
      updatedAt: numberingCounters.updatedAt,
    })
    .from(numberingCounters)
    .where(
      and(
        eq(numberingCounters.prefix, "SAL-ORD"),
        eq(numberingCounters.period, fallbackYear)
      )
    )
    .limit(1);

  const counterAgeSec = existing?.updatedAt
    ? (Date.now() - existing.updatedAt.getTime()) / 1000
    : Infinity;
  const counterIsFresh = existing && counterAgeSec < RESEED_AFTER_SECONDS;

  // Fast path: counter is fresh → trust it, skip the 4.7s lookup.
  if (counterIsFresh) {
    const n = await nextNumber("SAL-ORD", fallbackYear);
    return `SAL-ORD-${fallbackYear}-${n}`;
  }

  // Slow path: counter missing or > 60s old. Re-seed from the real max
  // across both tables in case ERP advanced its numbering during the
  // idle gap.
  const latest = await latestSalOrd();
  const year = latest?.year ?? fallbackYear;
  const observed = latest?.maxSeq ?? 0;

  if (observed > 0) {
    await db.execute(sql`
      INSERT INTO numbering_counters (prefix, period, value, updated_at)
      VALUES ('SAL-ORD', ${year}, ${observed}, NOW())
      ON CONFLICT (prefix, period) DO UPDATE
        SET value = GREATEST(numbering_counters.value, EXCLUDED.value),
            updated_at = NOW()
    `);
  }

  const n = await nextNumber("SAL-ORD", year);
  return `SAL-ORD-${year}-${n}`;
}

export async function allocInvoiceNumber(date: Date = new Date()): Promise<{
  invoiceNumber: string;
  financialYear: string;
}> {
  const fy = financialYear(date);
  const n = await nextNumber("INV", fy);
  return { invoiceNumber: `INV-${fy}-${pad(n, 5)}`, financialYear: fy };
}

export async function allocReturnNumber(date: Date = new Date()): Promise<string> {
  const year = String(date.getFullYear());
  const n = await nextNumber("RTN", year);
  return `RTN-${year}-${pad(n, 5)}`;
}

export async function allocClaimNumber(date: Date = new Date()): Promise<string> {
  // Missing-item claims — distinct prefix so customer care can tell at
  // a glance whether a row is an exchange (RTN-) or a missing claim (MIS-).
  const year = String(date.getFullYear());
  const n = await nextNumber("MIS", year);
  return `MIS-${year}-${pad(n, 5)}`;
}

export async function allocCustomerCode(date: Date = new Date()): Promise<string> {
  const year = String(date.getFullYear());
  const n = await nextNumber("CUST", year);
  return `CUST-${year}-${pad(n, 5)}`;
}

export async function allocShipmentNumber(date: Date = new Date()): Promise<string> {
  const fy = financialYear(date);
  const n = await nextNumber("SHP", fy);
  return `SHP-${fy}-${pad(n, 5)}`;
}

export async function allocPaymentNumber(date: Date = new Date()): Promise<string> {
  const year = String(date.getFullYear());
  const n = await nextNumber("PAY", year);
  return `PAY-${year}-${pad(n, 5)}`;
}

export async function allocPoNumber(date: Date = new Date()): Promise<string> {
  const fy = financialYear(date);
  const n = await nextNumber("PO", fy);
  return `PO-${fy}-${pad(n, 5)}`;
}
