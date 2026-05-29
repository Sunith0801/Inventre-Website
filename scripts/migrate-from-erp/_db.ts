/* eslint-disable no-console */
import { config } from "dotenv";
import fs from "fs";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../../db/schema";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");

export const client = postgres(url, { max: 5 });
export const db = drizzle(client, { schema });

// ─── Cutover boundary ───────────────────────────────────────────────
// Backfill must never modify rows the live website created since the
// website went live on 2026-05-25 17:11:09 UTC. Any local row with
// created_at >= this instant is fenced off. Read once from env so a
// single edit shifts the line for every script.
const CUTOVER_ISO =
  process.env.BACKFILL_CUTOVER_ISO ?? "2026-05-25T17:11:09Z";
export const CUTOVER_DATE = new Date(CUTOVER_ISO);
if (Number.isNaN(CUTOVER_DATE.getTime())) {
  throw new Error(
    `BACKFILL_CUTOVER_ISO is not a valid ISO date: ${CUTOVER_ISO}`
  );
}
export { CUTOVER_ISO };
/** Drizzle SQL fragment for the cutover instant — use in .where() / setWhere. */
export const CUTOVER_SQL = sql`${CUTOVER_ISO}::timestamptz`;

// ─── Dry-run mode ───────────────────────────────────────────────────
// Set when --dry-run is on the argv of any script. Steps must read this
// via isDryRun() rather than reparsing argv; the orchestrator propagates
// the flag to every child process.
export function isDryRun(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--dry-run");
}
export const DRY_RUN = isDryRun();

const REPORTS_DIR = path.resolve(
  process.cwd(),
  "scripts/migrate-from-erp/_reports"
);

export type DryRunDiff = {
  key: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  changedFields: string[];
};

export type DryRunReport = {
  script: string;
  entity: string;
  cutoverIso: string;
  startedAt: string;
  finishedAt: string;
  counts: {
    would_insert: number;
    would_update: number;
    would_skip_post_cutover: number;
    would_skip_unchanged: number;
    unresolved_dependency: number;
    errored: number;
  };
  sampleDiffs: DryRunDiff[];
};

export function newDryRunReport(script: string, entity: string): DryRunReport {
  return {
    script,
    entity,
    cutoverIso: CUTOVER_ISO,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    counts: {
      would_insert: 0,
      would_update: 0,
      would_skip_post_cutover: 0,
      would_skip_unchanged: 0,
      unresolved_dependency: 0,
      errored: 0,
    },
    sampleDiffs: [],
  };
}

const DRY_RUN_DIFF_SAMPLES = 20;

/** Push a diff into the report, capped at DRY_RUN_DIFF_SAMPLES. */
export function recordDryRunDiff(report: DryRunReport, diff: DryRunDiff): void {
  if (report.sampleDiffs.length < DRY_RUN_DIFF_SAMPLES) {
    report.sampleDiffs.push(diff);
  }
}

/** Compute field-level diff between an existing row and the new values. */
export function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
): string[] {
  if (!before) return Object.keys(after);
  const changed: string[] = [];
  for (const [k, v] of Object.entries(after)) {
    const bv = before[k];
    // JSON-stringify for deep-ish comparison; cheap and adequate for the diff sample.
    if (JSON.stringify(bv) !== JSON.stringify(v)) changed.push(k);
  }
  return changed;
}

/** Persist a dry-run report under _reports/. Idempotent: overwrites the
 * per-script file but appends a timestamped snapshot if the orchestrator
 * needs the full series. */
export async function writeDryRunReport(report: DryRunReport): Promise<string> {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
  report.finishedAt = new Date().toISOString();
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const outPath = path.join(REPORTS_DIR, `dry-run-${report.script}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  // Also write a "latest" alias for the orchestrator to glob.
  const latestPath = path.join(REPORTS_DIR, `dry-run-${report.script}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return outPath;
}

export function dryRunBanner(script: string): void {
  if (DRY_RUN) {
    console.log(`\n[${script}] *** DRY-RUN MODE *** — no rows will be written.\n`);
  }
}

export async function ensureCheckpointTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS migration_checkpoint (
      script_name TEXT PRIMARY KEY,
      processed_count INT NOT NULL DEFAULT 0,
      last_cursor TEXT,
      finished_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      error TEXT
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS migration_errors (
      id BIGSERIAL PRIMARY KEY,
      script_name TEXT NOT NULL,
      doctype TEXT,
      doc_name TEXT,
      error TEXT,
      raw JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function readCheckpoint(scriptName: string): Promise<{
  processed_count: number;
  last_cursor: string | null;
  finished_at: Date | null;
} | null> {
  const result = await db.execute(
    sql`SELECT processed_count, last_cursor, finished_at FROM migration_checkpoint WHERE script_name = ${scriptName}`
  );
  const rows = result as unknown as {
    processed_count: number;
    last_cursor: string | null;
    finished_at: Date | null;
  }[];
  return rows[0] ?? null;
}

export async function writeCheckpoint(
  scriptName: string,
  processed: number,
  cursor?: string | null,
  finished = false
) {
  const finishedAt = finished ? new Date().toISOString() : null;
  await db.execute(sql`
    INSERT INTO migration_checkpoint (script_name, processed_count, last_cursor, finished_at)
    VALUES (${scriptName}, ${processed}, ${cursor ?? null}, ${finishedAt}::timestamptz)
    ON CONFLICT (script_name) DO UPDATE SET
      processed_count = EXCLUDED.processed_count,
      last_cursor = EXCLUDED.last_cursor,
      finished_at = EXCLUDED.finished_at,
      error = NULL
  `);
}

export async function logMigrationError(
  scriptName: string,
  doctype: string,
  docName: string,
  error: string,
  raw?: unknown
) {
  await db.execute(sql`
    INSERT INTO migration_errors (script_name, doctype, doc_name, error, raw)
    VALUES (${scriptName}, ${doctype}, ${docName}, ${error}, ${raw ? JSON.stringify(raw) : null}::jsonb)
  `);
}

export async function shutdown() {
  await client.end();
}
