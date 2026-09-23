/**
 * One-off (P-01): seal legacy plain-text OTP codes already in `otp_logs`.
 *
 *   OTP_LOG_KEY=… DATABASE_URL=… npx tsx scripts/otp-logs-seal-legacy.ts [--apply]
 *
 * Without --apply it only counts. Rows older than 24 hours are NULLed rather
 * than sealed (the retention rule R2 does that nightly anyway); newer
 * rows are encrypted in place so support can still reveal them.
 */
import postgres from "postgres";
import { sealOtpCode } from "../server/otp-log-crypto";

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  if (apply && !process.env.OTP_LOG_KEY) throw new Error("OTP_LOG_KEY missing — nothing can be sealed");
  const sql = postgres(url, { max: 2 });
  try {
    const [{ legacy, stale }] = await sql<{ legacy: string; stale: string }[]>`
      SELECT
        count(*) FILTER (WHERE otp_code IS NOT NULL AND otp_code NOT LIKE 'enc:%' AND created_at >= now() - interval '1 day') AS legacy,
        count(*) FILTER (WHERE otp_code IS NOT NULL AND otp_code NOT LIKE 'enc:%' AND created_at <  now() - interval '1 day') AS stale
      FROM otp_logs`;
    console.log(`plain-text codes: ${legacy} recent (≤24h, will be sealed), ${stale} older (will be nulled)`);
    if (!apply) return console.log("dry run — re-run with --apply");

    const nulled = await sql`
      UPDATE otp_logs SET otp_code = NULL
      WHERE otp_code IS NOT NULL AND otp_code NOT LIKE 'enc:%' AND created_at < now() - interval '1 day'`;
    console.log(`nulled ${nulled.count} old codes`);

    let sealed = 0;
    for (;;) {
      const rows = await sql<{ id: string; otp_code: string }[]>`
        SELECT id, otp_code FROM otp_logs
        WHERE otp_code IS NOT NULL AND otp_code NOT LIKE 'enc:%'
        LIMIT 500`;
      if (rows.length === 0) break;
      await sql.begin(async (tx) => {
        for (const r of rows) {
          const v = sealOtpCode(r.otp_code);
          await tx`UPDATE otp_logs SET otp_code = ${v} WHERE id = ${r.id}`;
        }
      });
      sealed += rows.length;
    }
    console.log(`sealed ${sealed} codes`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
