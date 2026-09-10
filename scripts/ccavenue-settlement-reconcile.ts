/* eslint-disable no-console */
/**
 * Reconcile local order state against a CCAvenue SETTLEMENT / TRANSACTION
 * report export.
 *
 * WHY (the blind spot the Status-API path can't see):
 * CCAvenue's per-order Status API returns only the LATEST transaction for an
 * order_id, so a successful capture followed by an aborted retry reports as
 * *aborted* — the order sits `failed`/`pending` until a human notices (e.g.
 * SAL-ORD-2026-33890/33891, stuck 13-Jun → hand-healed 7-Jul). The settlement
 * report enumerates EVERY transaction, so it's the only feed that surfaces a
 * success hidden behind a later retry. This script trusts the report's own
 * status column and heals matching stuck local orders via the shared
 * finalizeOrderPayment primitive (same side effects + idempotency as a live
 * payment). See lib/ccavenue-settlement-reconcile.ts.
 *
 *   # safe dry-run (DEFAULT — parses + matches + reports, writes NOTHING):
 *   DATABASE_URL=… npx tsx --conditions=react-server \
 *     scripts/ccavenue-settlement-reconcile.ts --csv=path/to/settlement.csv
 *
 *   # actually heal (settles order+siblings, stock, SMS, invoice, ERP push):
 *   DATABASE_URL=… npx tsx --conditions=react-server \
 *     scripts/ccavenue-settlement-reconcile.ts --csv=path --apply
 *
 * The `--conditions=react-server` flag is REQUIRED: finalizeOrderPayment pulls
 * in lib/erp-bridge ("server-only"), which throws under plain tsx.
 *
 * Flags:
 *   --csv=PATH   Settlement/transaction CSV export (required).
 *   --apply      Actually heal. WITHOUT it = dry-run (default).
 *   --tolerance=N  ₹ slack on the capture-vs-group-total amount gate (default 1).
 *
 * SAFETY:
 *   - Dry-run is the default.
 *   - Only rows CCAvenue reports as a money-in state (Successful / Shipped /
 *     Captured / Settled) are considered.
 *   - An order is healed ONLY when the captured amount reconciles to the local
 *     basket total (hard gate — never flips to paid on an unreconcilable sum).
 *   - Idempotent: already-paid orders pass through as `already-paid`.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";

config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const getFlag = (name: string): string | undefined => {
    const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    const eq = hit.indexOf("=");
    return eq >= 0 ? hit.slice(eq + 1) : "";
  };

  const apply = getFlag("apply") !== undefined;
  const csvPath = getFlag("csv") ?? getFlag("file");
  const tolerance = Number(getFlag("tolerance") ?? "1") || 1;

  if (!csvPath) {
    console.error("ERROR: --csv=PATH is required (CCAvenue settlement export).");
    process.exit(1);
  }

  const abs = path.resolve(csvPath);

  // Import AFTER dotenv so DATABASE_URL / config resolve first.
  const { parseSettlementCsv, parseSettlementWorkbook, reconcileSettlement } =
    await import("@/server/ccavenue-settlement-reconcile");

  // CCAvenue's live SFTP push sends .xlsx; ops CSV exports still work.
  const rows = /\.(xlsx|xls)$/i.test(abs)
    ? parseSettlementWorkbook(readFileSync(abs))
    : parseSettlementCsv(readFileSync(abs, "utf8"));
  console.log(
    `\nParsed ${rows.length} rows from ${abs}\nMode: ${apply ? "APPLY (writing)" : "DRY-RUN (no writes)"}  tolerance=₹${tolerance}\n`
  );

  const report = await reconcileSettlement(rows, {
    apply,
    amountToleranceRupees: tolerance,
  });

  // Print the rows that matter: anything we (would) heal, plus every anomaly.
  const noteworthy = report.outcomes.filter(
    (o) => o.action !== "not-a-capture"
  );
  for (const o of noteworthy) {
    const tag = o.action.toUpperCase().padEnd(15);
    const on = o.orderNumber ? ` ${o.orderNumber}` : "";
    const amt =
      o.localGroupTotalRupees != null ? ` group=₹${o.localGroupTotalRupees}` : "";
    const ref = o.referenceNo ? ` ref=${o.referenceNo}` : "";
    const det = o.detail ? `  (${o.detail})` : "";
    console.log(`  ${tag}${on}${amt}${ref}  [${o.orderId}]${det}`);
  }

  console.log(
    `\n──────── SUMMARY ────────\n` +
      `  rows total        : ${report.totalRows}\n` +
      `  capture rows       : ${report.captureRows}\n` +
      `  ${apply ? "HEALED" : "would-heal"}          : ${apply ? report.healed : report.wouldHeal}\n` +
      `  already paid       : ${report.alreadyPaid}\n` +
      `  order not found    : ${report.notFound}\n` +
      `  amount mismatch    : ${report.amountMismatch}  (NOT healed — needs review)\n` +
      `  errors             : ${report.errors}\n`
  );

  if (!apply && report.wouldHeal > 0) {
    console.log(`Re-run with --apply to heal the ${report.wouldHeal} order(s) above.\n`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
