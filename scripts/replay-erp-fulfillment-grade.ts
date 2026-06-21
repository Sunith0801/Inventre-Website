/* eslint-disable no-console */
/**
 * TARGETED REPLAY: re-emit `order.updated` to the audit ERP so existing Sales
 * Orders pick up BOTH corrections in a single idempotent pass:
 *
 *   • #3 GRADE  — audit's `_apply_order` re-stamps `custom_student_grade` from
 *                 the payload on every order event. The corrected payload now
 *                 sends `students.grade` verbatim (lib/erp-bridge.ts), so the
 *                 +3-offset grades on audit get overwritten with the catalog
 *                 grade.
 *   • #4 STATUS — audit maps the inbound `status` string onto ERP
 *                 status/delivery_status ("delivered" -> "Fully Delivered").
 *                 Fulfilled orders that never re-emitted (no `order.updated`
 *                 was ever sent on the packed/shipped/delivered transition —
 *                 now fixed going forward by the emit hooks) get unstuck from
 *                 "To Deliver and Bill" / "Not Delivered".
 *
 * Re-emit is SAFE to repeat: audit dedupes by order_number and upserts, so
 * running this twice just re-applies the same corrected values.
 *
 * USAGE (npm alias supplies the required --conditions=react-server):
 *   npm run db:replay:erp-fulfillment -- [flags]
 *   raw: npx tsx --conditions=react-server scripts/replay-erp-fulfillment-grade.ts [flags]
 *
 * DEFAULT IS DRY-RUN. Nothing is emitted until you pass --apply.
 *
 * Scope flags (AND-combined; default scope = every non-cancelled order):
 *   --fulfilled-only     Only status IN (delivered, shipped, packed).
 *   --status=a,b,c       Restrict to these order statuses (csv).
 *   --school=CODE        Restrict to one school_code (e.g. QLPHP).
 *   --has-so             Only orders that already have an audit SO (erp_so_name
 *                        set). Off by default so missing SOs get (re)created.
 *   --since=YYYY-MM-DD   Only orders created on/after this date.
 *   --limit=N            Stop after N orders (smoke-test).
 *
 * Run flags:
 *   --apply              Actually emit. Without it, dry-run (count + breakdown).
 *   --batch-size=N       Keyset page size (default 200).
 *   --concurrency=N      Parallel emits in flight (default 8). emits are
 *                        latency-bound (1 payload build + 1 HTTPS POST each).
 *   --delay-ms=N         Sleep after each emit within a lane (default 0).
 *   --use-queue          Enqueue via the buffered erp_outbound_queue (drained
 *                        by the worker) instead of emitting directly. Direct
 *                        (default) gives synchronous per-order HTTP results.
 *
 * SAFETY:
 *   - Reuses the live payload builder + signing (buildErpOrderPayload ->
 *     postErpEvent -> HMAC). No divergence from the production emit path.
 *   - Targets whatever audit instance ERP_INGEST_URL points at — VERIFY it is
 *     the intended (dev) target before --apply. (dev .env.local ->
 *     http://217.216.58.218:8012 = audit-dev-backend-1.)
 *   - Keyset pagination on id (stable UUID order) — safe to resume.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  buildErpOrderPayload,
  postErpEvent,
  enqueueOrderEvent,
  emitStudentEvent,
} from "@/lib/erp-bridge";

const has = (f: string) => process.argv.includes(f);
const APPLY = has("--apply");
const FULFILLED_ONLY = has("--fulfilled-only");
const HAS_SO = has("--has-so");
const USE_QUEUE = has("--use-queue");
// Also re-emit `student.upserted` for the distinct linked students in scope.
// REQUIRED for the grade fix under audit ingests that treat the student master
// as the grade source of truth and override the order-payload grade (the
// audit-dev / exchange-flow behaviour): the master must be corrected first,
// then `_apply_student` re-stamps the student's Sales Orders. Harmless on
// audit-prod (which re-stamps grade straight from the order payload). On by
// default; --skip-students to emit orders only.
const SKIP_STUDENTS = has("--skip-students");

function strFlag(name: string): string | null {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.split("=").slice(1).join("=") : null;
}
function numFlag(name: string, dflt: number): number {
  const v = Number(strFlag(name));
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const VALID_STATUS = new Set([
  "placed",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
]);
const STATUS_CSV = strFlag("status");
const STATUSES = STATUS_CSV
  ? STATUS_CSV.split(",").map((s) => s.trim()).filter((s) => VALID_STATUS.has(s))
  : null;
const SCHOOL = strFlag("school"); // school_code
const SINCE = strFlag("since"); // YYYY-MM-DD
const LIMIT = numFlag("limit", Number.POSITIVE_INFINITY);
const BATCH_SIZE = numFlag("batch-size", 200);
const CONCURRENCY = numFlag("concurrency", 8);
const DELAY_MS = numFlag("delay-ms", 0);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── WHERE builder (validated fragments only — no raw user SQL) ───────────────
function buildWhere() {
  const conds = [sql`o.status <> 'cancelled'`];
  if (FULFILLED_ONLY) {
    conds.push(sql`o.status IN ('delivered','shipped','packed')`);
  }
  if (STATUSES && STATUSES.length) {
    conds.push(sql`o.status IN (${sql.join(STATUSES.map((s) => sql`${s}`), sql`, `)})`);
  }
  if (HAS_SO) conds.push(sql`o.erp_so_name IS NOT NULL`);
  if (SCHOOL) {
    conds.push(
      sql`o.school_id IN (SELECT id FROM schools WHERE school_code = ${SCHOOL})`,
    );
  }
  if (SINCE) conds.push(sql`o.created_at >= ${SINCE}::date`);
  return sql.join(conds, sql` AND `);
}

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = await db.execute(q);
  return (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as T[];
}

async function reportScope(where: ReturnType<typeof sql>): Promise<number> {
  const [{ n: total }] = await rows<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM orders o WHERE ${where}`,
  );
  console.log(`\n[replay] target orders: ${total}`);

  const byStatus = await rows<{ status: string; n: number }>(
    sql`SELECT o.status, COUNT(*)::int AS n FROM orders o WHERE ${where} GROUP BY o.status ORDER BY n DESC`,
  );
  console.log("[replay] by status:");
  for (const r of byStatus) console.log(`    ${r.status.padEnd(10)} ${r.n}`);

  const bySchool = await rows<{ code: string; n: number }>(
    sql`SELECT COALESCE(s.school_code,'(none)') AS code, COUNT(*)::int AS n
        FROM orders o LEFT JOIN schools s ON s.id = o.school_id
        WHERE ${where} GROUP BY s.school_code ORDER BY n DESC LIMIT 12`,
  );
  console.log("[replay] by school (top 12):");
  for (const r of bySchool) console.log(`    ${r.code.padEnd(14)} ${r.n}`);

  const [{ no_so: missingSo }] = await rows<{ no_so: number }>(
    sql`SELECT COUNT(*)::int AS no_so FROM orders o WHERE ${where} AND o.erp_so_name IS NULL`,
  );
  console.log(
    `[replay] of these, ${missingSo} have no audit SO yet (re-emit will (re)create them).`,
  );
  return total;
}

/** Run worker over items with at most `concurrency` in flight. */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
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

const stats = { emitted: 0, ok: 0, failed: 0, skipped: 0 };
const sstats = { emitted: 0, ok: 0, failed: 0 };

/** Re-emit student.upserted for every distinct linked student in scope, so
 *  audit's student master carries the corrected grade before the orders land. */
async function replayStudents(where: ReturnType<typeof sql>): Promise<void> {
  let cursor = "00000000-0000-0000-0000-000000000000";
  console.log(`\n[replay] emitting student.upserted for distinct linked students in scope...`);
  for (;;) {
    const page = await rows<{ student_id: string }>(
      sql`SELECT DISTINCT o.student_id FROM orders o
          WHERE ${where} AND o.student_id IS NOT NULL AND o.student_id > ${cursor}::uuid
          ORDER BY o.student_id ASC LIMIT ${BATCH_SIZE}`,
    );
    if (page.length === 0) break;
    cursor = page[page.length - 1].student_id;
    await runPool(page, CONCURRENCY, async (r) => {
      try {
        await emitStudentEvent(r.student_id);
        sstats.ok++;
      } catch {
        sstats.failed++;
      }
      sstats.emitted++;
    });
    console.log(`[replay] students: emitted=${sstats.emitted} ok=${sstats.ok} failed=${sstats.failed}`);
  }
}

async function emitOne(orderId: string): Promise<void> {
  if (USE_QUEUE) {
    const r = await enqueueOrderEvent(orderId, "order.updated");
    if (r) stats.ok++;
    else stats.failed++;
    stats.emitted++;
    return;
  }
  const payload = await buildErpOrderPayload(orderId);
  if (!payload) {
    stats.skipped++;
    return;
  }
  const res = await postErpEvent("order.updated", `order:${orderId}`, payload);
  stats.emitted++;
  if (res.ok) stats.ok++;
  else {
    stats.failed++;
    console.warn(`[replay] FAIL order ${orderId} -> HTTP ${res.status}: ${res.body.slice(0, 160)}`);
  }
}

async function main(): Promise<void> {
  console.log(
    `[replay] apply=${APPLY} use-queue=${USE_QUEUE} fulfilled-only=${FULFILLED_ONLY} ` +
      `status=${STATUSES?.join(",") ?? "*"} school=${SCHOOL ?? "*"} since=${SINCE ?? "*"} ` +
      `has-so=${HAS_SO} limit=${LIMIT} concurrency=${CONCURRENCY}`,
  );
  const where = buildWhere();
  const total = await reportScope(where);

  const [{ n: students }] = await rows<{ n: number }>(
    sql`SELECT COUNT(DISTINCT o.student_id)::int AS n FROM orders o WHERE ${where} AND o.student_id IS NOT NULL`,
  );
  console.log(
    `[replay] distinct linked students in scope: ${students}` +
      (SKIP_STUDENTS ? " (SKIPPED — --skip-students)" : " (will re-emit student.upserted)"),
  );

  if (!APPLY) {
    console.log(
      `\n[replay] DRY-RUN — nothing emitted. Re-run with --apply to emit` +
        (SKIP_STUDENTS ? "" : ` ${students} student.upserted +`) +
        ` ${Math.min(total, LIMIT)} order.updated events.`,
    );
    return;
  }

  if (!SKIP_STUDENTS) await replayStudents(where);

  console.log(`\n[replay] APPLYING — emitting order.updated for up to ${Math.min(total, LIMIT)} orders...`);
  let cursor = "00000000-0000-0000-0000-000000000000";
  let seen = 0;
  while (stats.emitted + stats.skipped < LIMIT) {
    const page = await rows<{ id: string }>(
      sql`SELECT o.id FROM orders o WHERE ${where} AND o.id > ${cursor}::uuid
          ORDER BY o.id ASC LIMIT ${BATCH_SIZE}`,
    );
    if (page.length === 0) break;
    const remaining = LIMIT - (stats.emitted + stats.skipped);
    const slice = page.slice(0, Math.max(0, Math.min(page.length, remaining)));
    cursor = slice[slice.length - 1]?.id ?? cursor;
    seen += slice.length;
    await runPool(slice, CONCURRENCY, (r) => emitOne(r.id));
    console.log(
      `[replay] progress: seen=${seen} emitted=${stats.emitted} ok=${stats.ok} failed=${stats.failed} skipped=${stats.skipped}`,
    );
  }
  console.log(
    `\n[replay] DONE — students(emitted=${sstats.emitted} ok=${sstats.ok} failed=${sstats.failed}) ` +
      `orders(emitted=${stats.emitted} ok=${stats.ok} failed=${stats.failed} skipped=${stats.skipped})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[replay] failed:", err);
    process.exit(1);
  });
