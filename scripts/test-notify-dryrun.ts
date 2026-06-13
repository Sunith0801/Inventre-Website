/* eslint-disable no-console */
/**
 * One-off LIVE dry run of the order-confirmation senders — DELETE AFTER USE.
 * Sends a real SMS + email to the recipients passed on the command line.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/test-notify-dryrun.ts <phone> <email>
 */
async function main() {
  const [phone, email] = process.argv.slice(2);
  if (!phone || !email) throw new Error("usage: test-notify-dryrun.ts <phone> <email>");

  const { sendOrderConfirmationSms } = await import("@/lib/sms");
  const { sendEmail } = await import("@/lib/email");

  try {
    const sms = await sendOrderConfirmationSms(phone, "Sunith", "SAL-ORD-TEST-001");
    console.log("SMS  →", sms.dev ? "DEV STUB (no creds set!)" : "SENT", "txn:", sms.transactionId);
    console.log("     text:", sms.text);
  } catch (e) {
    console.log("SMS  → FAILED:", e instanceof Error ? e.message : e);
  }

  const res = await sendEmail({
    to: email,
    subject: "Order SAL-ORD-TEST-001 confirmed — Inventre (dry run)",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c1917">
      <h2 style="color:#c2410c;margin-bottom:4px">Order confirmed</h2>
      <p>Dear Sunith,</p>
      <p>Your order <strong>SAL-ORD-TEST-001</strong> has been successfully placed.</p>
      <p style="font-size:18px;margin:16px 0"><strong>Order total: ₹1,234</strong></p>
      <p>You will receive updates once it is processed.</p>
      <p style="margin:24px 0"><a href="https://inventre.in/shop/orders" style="background:#c2410c;color:#fff;padding:12px 24px;border-radius:9999px;text-decoration:none;font-weight:bold">Track your order</a></p>
      <p style="color:#78716c;font-size:12px;margin-top:32px">INVENTRE EDUSERVICES PVT. LTD — this is a dry-run test.</p>
    </div>`,
    text: "Dear Sunith,\n\nYour order SAL-ORD-TEST-001 has been successfully placed. (dry-run test)\n\nINVENTRE EDUSERVICES PVT. LTD",
  });
  console.log("MAIL →", res.ok ? `SENT id=${res.id}` : `FAILED: ${res.error}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
