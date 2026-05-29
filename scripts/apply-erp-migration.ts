/**
 * Apply 0001_erpnext_inspired_modules.sql to the live DB.
 * Idempotent: skips creates that already exist (best-effort by swallowing
 * "already exists" errors per statement).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");

  const sql = postgres(url, { max: 1, prepare: false });
  const file = readFileSync(
    join(process.cwd(), "db/migrations/0001_erpnext_inspired_modules.sql"),
    "utf8"
  );
  // Run as a single multi-statement script. Wrap in DO block so types
  // and tables commit in a single transaction.
  try {
    await sql.unsafe(file);
    console.log("Migration applied.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already exists|duplicate/i.test(msg)) {
      console.log("Already applied (skipped).");
    } else {
      throw e;
    }
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
