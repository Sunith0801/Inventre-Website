/**
 * Production migrator — file-based, drizzle-journal-independent.
 *
 * Why not `drizzle-orm/postgres-js/migrator`?
 *   The drizzle migrator only applies SQL files registered in
 *   `db/migrations/meta/_journal.json`. In this repo, only the first two
 *   migrations were created via `drizzle-kit generate`; everything from
 *   0002_numbering_counters.sql onward was hand-written and never
 *   journal-registered. Using the drizzle migrator on a fresh DB would
 *   silently SKIP everything 0002 → present, producing a half-built schema.
 *
 * Behaviour:
 *   1. Connect via DATABASE_DIRECT_URL (DDL needs a session-pinned conn).
 *   2. Ensure `__schema_migrations(filename, applied_at)` exists.
 *   3. **Bootstrap**: on the first run against an existing DB (one already
 *      migrated by hand / `drizzle-kit push` / a previous deploy), detect
 *      which migrations are already in effect by checking for canonical
 *      tables they create, and mark them as applied so they aren't re-run.
 *      This avoids "type already exists" failures on legacy migrations 0000
 *      and 0001 which weren't written with `IF NOT EXISTS` guards.
 *   4. Read every `*.sql` file under db/migrations, sorted lexicographically.
 *   5. For each file not present in `__schema_migrations`, execute its
 *      contents inside one transaction and record it.
 *
 * Idempotent on its own (CREATE TABLE IF NOT EXISTS + bootstrap + tracking
 * table). Safe to run on every container start. Failures abort the process;
 * the entrypoint script decides whether to fall through (see
 * MIGRATIONS_REQUIRED in scripts/start.sh).
 */
import postgres from "postgres";
import path from "path";
import fs from "fs";

/**
 * Map each migration file to one or more tables it definitively creates.
 * If ALL listed tables exist on first migrator run, the file is treated
 * as already applied. Keep this in sync when adding new migrations.
 */
/**
 * Historical data seeds that CANNOT be replayed onto today's schema.
 *
 * 0037 is a pg_dump of the May-2026 dev catalog, taken when `schools` still
 * had `grade_offset` and `kit_label`. Those two columns are gone from
 * db/schema.ts but still stand on the live databases, so its positional
 * `INSERT INTO public.schools VALUES (...)` carries 35 values for what is now
 * a 33-column table and fails with "INSERT has more expressions than target
 * columns". Rewriting 3.7 MB of dumped rows to today's shape would mean
 * editing historical data by hand, which is worse than not replaying it.
 *
 * So it is skipped — ONLY when MIGRATE_SKIP_HISTORICAL_SEEDS=1, which CI sets
 * when it builds a throwaway database to compile against. The live databases
 * have long since applied 0037 and never re-read it; nothing about their path
 * changes. A database built with this flag has the full SCHEMA and none of
 * that seed's catalog ROWS, which is exactly what a build gate needs and is
 * not a substitute for a restore.
 */
const HISTORICAL_SEEDS = new Set(["0037_catalog_data_backfill.sql"]);

const BOOTSTRAP_FINGERPRINTS: Record<string, string[]> = {
  "0000_phase1_option_b_foundation.sql": ["parents", "products", "orders"],
  "0001_erpnext_inspired_modules.sql": ["suppliers", "purchase_orders"],
  "0002_numbering_counters.sql": ["numbering_counters"],
  "0003_purchase_invoices.sql": ["purchase_invoices"],
  "0004_loyalty_gift_cards.sql": ["loyalty_ledger", "gift_cards"],
  "0005_school_color_map.sql": ["school_color_map"],
};

async function main() {
  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "[migrate] DATABASE_DIRECT_URL or DATABASE_URL must be set"
    );
    process.exit(1);
  }

  const client = postgres(url, { max: 1, prepare: false });

  try {
    await client/* sql */`
      CREATE TABLE IF NOT EXISTS __schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    // ── Bootstrap pass ─────────────────────────────────────────
    // For each fingerprinted migration, if it isn't already in our tracking
    // table but its canonical tables exist, mark it applied. This skips
    // re-running legacy non-idempotent migrations against an existing DB.
    {
      const tableExists = async (t: string): Promise<boolean> => {
        const rows = await client<{ exists: boolean }[]>/* sql */`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ${t}
          ) AS exists
        `;
        return rows[0]?.exists ?? false;
      };
      const trackedRows = await client<{ filename: string }[]>/* sql */`
        SELECT filename FROM __schema_migrations
      `;
      const tracked = new Set(trackedRows.map((r) => r.filename));
      let bootstrapped = 0;
      for (const [file, tables] of Object.entries(BOOTSTRAP_FINGERPRINTS)) {
        if (tracked.has(file)) continue;
        const allPresent = (
          await Promise.all(tables.map(tableExists))
        ).every(Boolean);
        if (allPresent) {
          await client/* sql */`
            INSERT INTO __schema_migrations (filename) VALUES (${file})
            ON CONFLICT DO NOTHING
          `;
          bootstrapped++;
          console.log(`[migrate] bootstrap: ${file} (tables present)`);
        }
      }
      if (bootstrapped > 0) {
        console.log(
          `[migrate] bootstrap recorded ${bootstrapped} pre-applied migration(s)`
        );
      }
    }

    // ── Apply pending ──────────────────────────────────────────
    const dir = path.resolve(process.cwd(), "db", "migrations");
    const allFiles = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    if (allFiles.length === 0) {
      console.log(`[migrate] no SQL files in ${dir}`);
      return;
    }

    const appliedRows = await client<{ filename: string }[]>/* sql */`
      SELECT filename FROM __schema_migrations
    `;
    const applied = new Set(appliedRows.map((r) => r.filename));

    const pending = allFiles.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log(`[migrate] up to date (${allFiles.length} migrations)`);
      return;
    }

    console.log(
      `[migrate] applying ${pending.length} migration(s): ${pending.join(", ")}`
    );

    const skipHistoricalSeeds =
      process.env.MIGRATE_SKIP_HISTORICAL_SEEDS === "1";

    for (const file of pending) {
      if (skipHistoricalSeeds && HISTORICAL_SEEDS.has(file)) {
        await client/* sql */`
          INSERT INTO __schema_migrations (filename) VALUES (${file})
          ON CONFLICT DO NOTHING
        `;
        console.log(
          `[migrate]   — ${file} (historical seed, skipped by MIGRATE_SKIP_HISTORICAL_SEEDS)`
        );
        continue;
      }

      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      // Wrap each migration in its own transaction so partial failures don't
      // poison the next one. postgres.js .begin() commits on resolve, rolls
      // back on throw.
      try {
        await client.begin(async (tx) => {
          await tx.unsafe(sql);
          await tx/* sql */`
            INSERT INTO __schema_migrations (filename) VALUES (${file})
          `;
        });
        console.log(`[migrate]   ✓ ${file}`);
      } catch (e) {
        console.error(`[migrate]   ✗ ${file}:`, e);
        throw e;
      }
    }

    console.log("[migrate] complete");
  } catch (e) {
    console.error("[migrate] failed:", e);
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 5 });
  }
}

main();
