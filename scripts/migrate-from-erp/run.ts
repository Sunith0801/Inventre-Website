/* eslint-disable no-console */
/**
 * Orchestrator — runs all migration scripts in order.
 * Each step is independent and resumable; if any step fails, fix and re-run.
 *
 *   npx tsx scripts/migrate-from-erp/run.ts                       # full migration (live writes)
 *   npx tsx scripts/migrate-from-erp/run.ts --dry-run             # no writes, JSON report under _reports/
 *   npx tsx scripts/migrate-from-erp/run.ts --sample=10 --dry-run # 10 rec/step smoke test
 *   npx tsx scripts/migrate-from-erp/run.ts --school=KLINK
 *   npx tsx scripts/migrate-from-erp/run.ts --skip=08-customers,09-addresses
 *
 * After --dry-run, find aggregated reports at
 *   scripts/migrate-from-erp/_reports/dry-run-<step>-latest.json
 *   scripts/migrate-from-erp/_reports/dry-run-summary-<ts>.json
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const STEPS = [
  "00-probe",
  "01-attributes",
  "02-categories",
  "03-schools",
  "04-items",
  "05-variants",
  "06-prices",
  "07-stock",
  "08-customers",
  "09-addresses",
  "10-orders",
  "11-invoices",
  "verify",
];

// Steps that have NOT been instrumented for --dry-run. They write
// unconditionally when invoked, so the orchestrator skips them when
// --dry-run is on. They're already idempotent (onConflictDoNothing or
// natural-key upsert) and exist outside the post-cutover danger zone,
// so a dry-run plan doesn't need them in the loop.
const NON_DRY_RUN_STEPS = new Set([
  "01-attributes",
  "02-categories",
  "03-schools",
  "07-stock",
  "08b-customers-phoneless",
]);

const REPORTS_DIR = path.resolve(
  process.cwd(),
  "scripts/migrate-from-erp/_reports"
);

function runStep(step: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const file = path.join("scripts", "migrate-from-erp", `${step}.ts`);
    const proc = spawn("npx", ["tsx", file, ...args], { stdio: "inherit", shell: true });
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

function aggregateDryRunReports(stamp: string): void {
  if (!fs.existsSync(REPORTS_DIR)) return;
  const files = fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => /^dry-run-.+-latest\.json$/.test(f));
  if (files.length === 0) return;
  const merged: Record<string, unknown> = {
    aggregatedAt: new Date().toISOString(),
    stepReports: {},
  };
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), "utf8"));
      const key = (j.script ?? f.replace("dry-run-", "").replace("-latest.json", ""));
      (merged.stepReports as Record<string, unknown>)[key] = j;
    } catch {
      // skip malformed
    }
  }
  const outPath = path.join(REPORTS_DIR, `dry-run-summary-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\n  📄 dry-run summary written to ${outPath}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const skipArg = args.find((a) => a.startsWith("--skip="));
  const skipList = skipArg ? skipArg.split("=")[1].split(",") : [];
  const passThrough = args.filter((a) => !a.startsWith("--skip="));
  const dryRun = args.includes("--dry-run");

  console.log(`\n${"═".repeat(72)}`);
  console.log("ERPNext → Inventre migration orchestrator");
  console.log(`${"═".repeat(72)}\n`);
  if (dryRun) console.log("  *** DRY-RUN MODE *** — no rows will be written.\n");
  if (skipList.length) console.log(`  Skipping: ${skipList.join(", ")}`);
  if (passThrough.length) console.log(`  Args:     ${passThrough.join(" ")}`);

  // Ensure the reports directory exists up front so children can write into it.
  if (dryRun && !fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const start = Date.now();
  for (const step of STEPS) {
    if (skipList.includes(step)) {
      console.log(`\n⤳ skip ${step}`);
      continue;
    }
    if (dryRun && NON_DRY_RUN_STEPS.has(step)) {
      console.log(`\n⤳ skip ${step} (no dry-run instrumentation; idempotent — run in live mode)`);
      continue;
    }
    console.log(`\n${"─".repeat(72)}\n→ ${step}\n${"─".repeat(72)}`);
    const stepArgs = step === "00-probe" || step === "verify" ? [] : passThrough;
    const code = await runStep(step, stepArgs);
    if (code !== 0) {
      console.error(`\n✗ ${step} exited ${code}. Stopping. Re-run with same args after fixing.\n`);
      if (dryRun) aggregateDryRunReports(new Date().toISOString().replace(/[:.]/g, "-"));
      process.exit(code);
    }
  }
  const mins = ((Date.now() - start) / 60000).toFixed(1);
  if (dryRun) aggregateDryRunReports(new Date().toISOString().replace(/[:.]/g, "-"));
  console.log(`\n${"═".repeat(72)}\n✓ ALL STEPS COMPLETE in ${mins} minutes\n${"═".repeat(72)}\n`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
