/* eslint-disable no-console */
/**
 * One-time backfill: RE-EMIT student + order webhook events to the audit ERP
 * (https://audit.inventre.in `/api/ecom/ingest`) so historical records pick up
 * the newly-added payload fields:
 *
 *   • orders  → `placed_at`      (full ISO-8601 placed timestamp)
 *   • students→ `reference_code` (MCB ref / admission code)
 *
 * Webhooks otherwise only fire on NEW changes, so existing rows in audit never
 * receive the new keys until something edits them. This walks the whole dataset
 * and re-fires the same `student.upserted` / `order.updated` events.
 *
 *   DATABASE_URL=… npm run db:backfill:erp -- [flags]
 *
 * (The npm alias supplies the required `--conditions=react-server` flag —
 *  lib/erp-bridge.ts imports "server-only", which otherwise throws under tsx.
 *  Pass flags after `--`, e.g. `npm run db:backfill:erp -- --dry-run`.
 *  Raw equivalent: `npx tsx --conditions=react-server scripts/backfill-erp-reemit.ts`.)
 *
 * Flags:
 *   --dry-run          Count + page through, but emit NOTHING.
 *   --students-only    Skip orders.
 *   --orders-only      Skip students.
 *   --batch-size=N     Rows per page (default 200).
 *   --limit=N          Stop after N emits per entity (smoke-test).
 *   --delay-ms=N       Sleep after each emit within a lane (default 0).
 *   --concurrency=N    Parallel emits in flight (default 1 = serial). Higher is
 *                      much faster (emits are latency-bound) but loads the ERP
 *                      + DB pool harder; 16 is a sane fast default for dev.
 *
 * SAFETY / IDEMPOTENCY:
 *   - Reuses the EXACT live payload builders + signing (emitStudentEvent /
 *     emitOrderEvent → build*Payload → postErpEvent → HMAC over raw body), so
 *     no event_type, field, or signature scheme diverges from production.
 *   - emitStudentEvent / emitOrderEvent swallow their own errors (log only),
 *     so one bad row never aborts the run.
 *   - Audit dedupes students by enrolment / erp_name and orders by
 *     order_number, so re-running is safe — it just re-upserts.
 *   - Keyset pagination on `id` (stable UUID order) means progress survives
 *     even if rows are added mid-run; no OFFSET drift.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { emitStudentEvent, emitOrderEvent } from "@/server/erp-bridge";

const DRY_RUN = process.argv.includes("--dry-run");
const STUDENTS_ONLY = process.argv.includes("--students-only");
const ORDERS_ONLY = process.argv.includes("--orders-only");

function numFlag(name: string, dflt: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return dflt;
  const v = Number(raw.split("=")[1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const BATCH_SIZE = numFlag("batch-size", 200);
const LIMIT = numFlag("limit", Number.POSITIVE_INFINITY);
const DELAY_MS = numFlag("delay-ms", 0);
// How many emits run concurrently. Default 1 = the original strictly-serial
// behaviour. Higher = far faster (each emit is ~5 DB queries + 1 HTTP POST, so
// it's latency-bound and parallelises well), at the cost of more simultaneous
// load on the audit ERP and DB pool. emit*Event swallow their own errors, so
// a failure in one slot never rejects the pool.
const CONCURRENCY = numFlag("concurrency", 1);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `worker` over `items` with at most `concurrency` in flight at once. */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
}

/** Keyset-paginate one table's ids (UUID ascending) and run `emit` on each. */
async function backfill(
  label: string,
  table: "students" | "orders",
  emit: (id: string) => Promise<void>,
): Promise<void> {
  const totalRes = await db.execute(
    table === "students"
      ? sql`SELECT COUNT(*)::int AS n FROM students`
      : sql`SELECT COUNT(*)::int AS n FROM orders`,
  );
  const totalRows = (Array.isArray(totalRes) ? totalRes : (totalRes as { rows?: unknown[] }).rows ?? []) as {
    n: number;
  }[];
  const total = Number(totalRows[0]?.n ?? 0);
  console.log(
    `\n[backfill] ${label}: ${total} total rows (batch=${BATCH_SIZE}, concurrency=${CONCURRENCY}, delay-ms=${DELAY_MS}, limit=${LIMIT})`,
  );

  let cursor = "00000000-0000-0000-0000-000000000000";
  let processed = 0;
  let emitted = 0;

  while (emitted < LIMIT) {
    const pageRes = await db.execute(
      table === "students"
        ? sql`SELECT id FROM students WHERE id > ${cursor}::uuid ORDER BY id ASC LIMIT ${BATCH_SIZE}`
        : sql`SELECT id FROM orders   WHERE id > ${cursor}::uuid ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
    );
    const page = (Array.isArray(pageRes) ? pageRes : (pageRes as { rows?: unknown[] }).rows ?? []) as {
      id: string;
    }[];
    if (page.length === 0) break;

    // Respect --limit by trimming the page to the remaining quota.
    const remaining = LIMIT - emitted;
    const slice = page.slice(0, Math.max(0, Math.min(page.length, remaining)));
    cursor = slice[slice.length - 1]?.id ?? cursor;
    processed += slice.length;

    if (!DRY_RUN) {
      await runPool(slice, CONCURRENCY, (row) => emit(row.id));
    }
    emitted += slice.length;

    console.log(
      `[backfill] ${label}: ${emitted} emitted / ${processed} seen (${total ? Math.round((processed / total) * 100) : 0}%)`,
    );
  }

  console.log(
    `[backfill] ${label}: DONE — ${emitted} ${DRY_RUN ? "would be emitted (dry-run)" : "emitted"}`,
  );
}

async function main(): Promise<void> {
  console.log(`[backfill] dry-run=${DRY_RUN} students-only=${STUDENTS_ONLY} orders-only=${ORDERS_ONLY}`);

  if (!ORDERS_ONLY) {
    await backfill("students (student.upserted)", "students", emitStudentEvent);
  }
  if (!STUDENTS_ONLY) {
    await backfill("orders (order.updated)", "orders", (id) => emitOrderEvent(id, "order.updated"));
  }

  console.log(`\n[backfill] complete.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exit(1);
  });
