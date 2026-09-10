/* eslint-disable no-console */
/**
 * One-off remediation: re-verify CCAvenue orders stuck in `failed` / `pending`
 * against CCAvenue's Status API and FINALISE the ones the gateway actually
 * captured. This heals "money taken but order stuck failed" cases — most
 * notably retries whose success callback was swallowed by the old
 * payment_finalized latch (see fix in lib/ccavenue-finalize.ts).
 *
 *   # safe dry-run (DEFAULT — polls + reports, writes NOTHING):
 *   npx tsx --conditions=react-server scripts/remediate-ccavenue-stuck.ts
 *   # or via alias:
 *   npm run db:remediate:ccavenue
 *
 *   # actually heal (writes: settles order, decrements stock, SMS, invoice, ERP):
 *   npm run db:remediate:ccavenue -- --apply
 *
 * The `--conditions=react-server` flag is REQUIRED: finalizeOrderPayment pulls
 * in lib/erp-bridge ("server-only"), which throws under plain tsx.
 *
 * Flags:
 *   --apply            Actually finalise paid orders. WITHOUT it = dry-run.
 *   --captured-only    Only orders that already have paid_amount > 0 recorded
 *                      (~the highest-signal set). Default also includes any
 *                      failed/pending CCAvenue order that carries a tracking id.
 *   --limit=N          Stop after N candidates (smoke-test).
 *   --delay-ms=N       Sleep between Status API calls (default 300) — be kind
 *                      to CCAvenue + our own DB pool.
 *   --order=SAL-ORD-…  Remediate a single order_number (ignores the filters).
 *
 * SAFETY:
 *   - Dry-run is the default; you must pass --apply to write anything.
 *   - Uses the SAME finalizeOrderPayment the live callback/cron use, so every
 *     side effect (stock, coupon, SMS, invoice, ERP enqueue) is identical to a
 *     normal payment — and it is idempotent + race-safe (atomic paid claim),
 *     so re-running is safe and an already-paid order is a no-op.
 *   - Only acts when CCAvenue's Status API reports the txn PAID. Anything else
 *     (still failed / pending / unknown) is left untouched and just counted.
 */
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  fetchCCAvenueOrderStatus,
  isCCAvenueConfigured,
} from "@/server/ccavenue";
import { finalizeOrderPayment } from "@/server/ccavenue-finalize";

const APPLY = process.argv.includes("--apply");
const CAPTURED_ONLY = process.argv.includes("--captured-only");

function numFlag(name: string): number | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return null;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : null;
}
function strFlag(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

const LIMIT = numFlag("limit");
const DELAY_MS = numFlag("delay-ms") ?? 300;
const ONE_ORDER = strFlag("order");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  order_id: string;
  order_number: string;
  total: number | null;
  status: string;
  gateway_tracking_id: string | null;
  paid_amount: string | null;
};

async function loadCandidates(): Promise<Row[]> {
  const whereFilter = ONE_ORDER
    ? sql`o.order_number = ${ONE_ORDER}`
    : sql`p.status IN ('failed','pending') AND ${
        CAPTURED_ONLY
          ? sql`(p.paid_amount IS NOT NULL AND p.paid_amount::numeric > 0)`
          : sql`(p.gateway_tracking_id IS NOT NULL OR (p.paid_amount IS NOT NULL AND p.paid_amount::numeric > 0))`
      }`;

  const res = await db.execute(sql`
    SELECT o.id::text AS order_id,
           o.order_number,
           o.total,
           p.status,
           p.gateway_tracking_id,
           p.paid_amount
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE ${whereFilter}
    ORDER BY p.created_at
    ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}
  `);
  // node-postgres → {rows}; postgres.js → array. Handle both.
  const rows = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
  return rows as Row[];
}

async function main() {
  if (!isCCAvenueConfigured()) {
    console.error("CCAvenue is not configured in this environment — aborting.");
    process.exit(1);
  }
  console.log(
    `[remediate-ccavenue] mode=${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes)"} ` +
      `capturedOnly=${CAPTURED_ONLY} delayMs=${DELAY_MS}` +
      (LIMIT ? ` limit=${LIMIT}` : "") +
      (ONE_ORDER ? ` order=${ONE_ORDER}` : "")
  );

  const rows = await loadCandidates();
  console.log(`[remediate-ccavenue] ${rows.length} candidate order(s) to re-verify.`);

  let gatewayPaid = 0; // gateway says paid
  let healed = 0; // actually finalised this run
  let noChange = 0; // gateway paid but finalize said no-change (already paid / race)
  let stillFailed = 0;
  let stillPending = 0;
  let unknown = 0;
  let errors = 0;

  for (const r of rows) {
    try {
      const normalized = await fetchCCAvenueOrderStatus({
        orderNo: r.order_id, // CCAvenue knows the txn by orders.id (UUID)
        referenceNo: r.gateway_tracking_id ?? null,
      });

      if (normalized.status === "paid") {
        gatewayPaid++;
        if (!APPLY) {
          console.log(
            `WOULD-HEAL ${r.order_number} (${r.order_id}) localStatus=${r.status} ` +
              `cca=${normalized.rawStatus} ref=${normalized.trackingId ?? "-"} paid=${normalized.paidAmount ?? "-"}`
          );
        } else {
          const fin = await finalizeOrderPayment({
            orderId: r.order_id,
            source: "cron-reconcile",
            normalized,
          });
          if (fin.kind === "marked-paid") {
            healed++;
            console.log(`HEALED ${r.order_number} → paid+confirmed`);
          } else {
            noChange++;
            console.log(
              `no-change ${r.order_number} (${fin.kind}${"reason" in fin ? `/${fin.reason}` : ""})`
            );
          }
        }
      } else if (normalized.status === "failed") {
        stillFailed++;
      } else if (normalized.status === "pending") {
        stillPending++;
      } else {
        unknown++;
        console.log(
          `unknown ${r.order_number} cca=${normalized.rawStatus ?? "-"} (left untouched)`
        );
      }
    } catch (e) {
      errors++;
      console.error(
        `ERROR ${r.order_number} (${r.order_id}):`,
        e instanceof Error ? e.message : e
      );
    }
    if (DELAY_MS) await sleep(DELAY_MS);
  }

  console.log("──────────────────────────────────────────────");
  console.log(`[remediate-ccavenue] done. candidates=${rows.length}`);
  console.log(`  gateway PAID:        ${gatewayPaid}` + (APPLY ? ` (healed=${healed}, no-change=${noChange})` : " (dry-run, nothing written)"));
  console.log(`  gateway still failed: ${stillFailed}`);
  console.log(`  gateway pending:      ${stillPending}`);
  console.log(`  gateway unknown:      ${unknown}`);
  console.log(`  errors:               ${errors}`);
  if (!APPLY && gatewayPaid > 0) {
    console.log(`\n  Re-run with --apply to finalise the ${gatewayPaid} captured order(s).`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[remediate-ccavenue] fatal:", e);
  process.exit(1);
});
