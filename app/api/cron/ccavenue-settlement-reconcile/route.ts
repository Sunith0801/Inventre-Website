/**
 * Daily settlement-report reconciliation for CCAvenue.
 *
 * Closes the blind spot the per-order Status-API cron (ccavenue-reconcile)
 * structurally cannot see: a SUCCESSFUL capture followed by an aborted retry
 * on the same order_id. The Status API returns only the latest (aborted)
 * transaction, so those orders sit `failed`/`pending` until a human notices
 * (SAL-ORD-2026-33890/33891 sat stuck 13-Jun → 7-Jul). CCAvenue's settlement /
 * transaction report enumerates EVERY transaction, so it's the one feed that
 * surfaces the hidden success — this cron ingests it and heals matching stuck
 * orders through the shared finalizeOrderPayment primitive.
 *
 * FEED: CCAvenue doesn't push the settlement report to us, and its report API
 * credentials aren't provisioned on this merchant account yet. So ops drops
 * the daily dashboard export (CSV) into `CCAVENUE_SETTLEMENT_DIR`; this cron
 * drains that directory, heals, and renames each processed file to `*.done`
 * so it isn't reprocessed. Wire the live report API in later by feeding its
 * rows to reconcileSettlement() — the healing path is identical.
 *
 *   GET /api/cron/ccavenue-settlement-reconcile
 *   Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Idempotent + amount-gated: an already-paid order is a no-op, and an order is
 * only flipped to paid when the captured amount reconciles to the local basket
 * total. Safe to run daily (or hourly).
 */
import { NextResponse } from "next/server";
import { readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import {
  reconcileSettlementCsv,
  reconcileSettlementWorkbook,
} from "@/lib/ccavenue-settlement-reconcile";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dir = process.env.CCAVENUE_SETTLEMENT_DIR;
  if (!dir) {
    return NextResponse.json(
      { ok: true, skipped: "no_settlement_dir" },
      { status: 200 }
    );
  }

  let files: string[];
  try {
    // CCAvenue's live SFTP push sends .xlsx; ops CSV exports are still
    // supported. `.done.*` marks an already-processed file.
    files = (await readdir(dir))
      .filter((f) => /\.(csv|xlsx|xls)$/i.test(f) && !/\.done\.[^.]+$/i.test(f))
      .sort();
  } catch (e) {
    // Directory missing / unreadable — treat as nothing to do, but surface it.
    return NextResponse.json(
      { ok: true, skipped: "settlement_dir_unreadable", detail: String(e) },
      { status: 200 }
    );
  }

  const results: Array<Record<string, unknown>> = [];
  let totalHealed = 0;
  let totalMismatch = 0;
  let totalErrors = 0;

  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const isWorkbook = /\.(xlsx|xls)$/i.test(file);
      const report = isWorkbook
        ? await reconcileSettlementWorkbook(await readFile(full), { apply: true })
        : await reconcileSettlementCsv(await readFile(full, "utf8"), { apply: true });
      totalHealed += report.healed;
      totalMismatch += report.amountMismatch;
      totalErrors += report.errors;
      results.push({
        file,
        healed: report.healed,
        alreadyPaid: report.alreadyPaid,
        notFound: report.notFound,
        amountMismatch: report.amountMismatch,
        errors: report.errors,
        // Surface anything that needs a human: mismatches + finalize errors.
        needsReview: report.outcomes
          .filter(
            (o) => o.action === "amount-mismatch" || o.action === "error"
          )
          .map((o) => ({
            orderId: o.orderId,
            orderNumber: o.orderNumber,
            action: o.action,
            detail: o.detail,
          })),
      });
      // Mark processed so the next run skips it.
      await rename(full, full.replace(/\.([^.]+)$/i, ".done.$1"));
    } catch (e) {
      totalErrors++;
      results.push({ file, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    filesProcessed: results.length,
    totalHealed,
    totalMismatch,
    totalErrors,
    results,
  });
}
