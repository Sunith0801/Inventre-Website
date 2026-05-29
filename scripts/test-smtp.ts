/**
 * Quick SMTP smoke test. Usage:
 *   npx tsx scripts/test-smtp.ts you@example.com
 *
 * Loads .env.local first (dev defaults — DATABASE_URL etc.), then layers
 * .env.deploy on top with override so the SMTP_* / EMAIL_FROM under test
 * are the production values, not whatever stale dev-only EMAIL_FROM the
 * .env.local happens to carry. Both files are gitignored.
 *
 * Prints exactly the SMTP error if Microsoft 365 rejects auth — so we can tell
 * "wrong password" from "SMTP AUTH disabled on the mailbox" from the
 * "From-address ≠ authenticated user" SendAs check.
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.deploy", override: true });

import { sendEmail } from "../lib/email";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: npx tsx scripts/test-smtp.ts <recipient-email>");
    process.exit(2);
  }
  console.log("Transport env:");
  console.log("  SMTP_HOST =", process.env.SMTP_HOST);
  console.log("  SMTP_PORT =", process.env.SMTP_PORT);
  console.log("  SMTP_USER =", process.env.SMTP_USER);
  console.log("  EMAIL_FROM =", process.env.EMAIL_FROM);
  console.log("Sending to:", to);

  const result = await sendEmail({
    to,
    subject: "Inventre SMTP test",
    text: "If you can read this, SMTP is working.",
    html: "<p>If you can read this, <b>SMTP is working</b>.</p>",
  });

  console.log("Result:", result);
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
