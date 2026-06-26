import { NextResponse } from "next/server";
import crypto from "crypto";
import { getErpConfig } from "@/lib/erp-config";
import { findStrandedOrders, markStrandedAlerted } from "@/lib/erp-stranded";
import { sendEmail, isEmailConfigured } from "@/lib/email";

/**
 * Cron-only stranded-order alert for the audit (ERP) outbound sync.
 *
 * Runs hourly. Flags confirmed+paid orders that have sat unmirrored to
 * audit for longer than the grace window (default 2h) and emails ops.
 * Auth: same shared CRON_TOKEN as /api/cron/erp-drain.
 *
 * Recipients come from ALERT_EMAIL (comma-separated) when set, else the
 * baked-in ops list. Grace window overridable via STRANDED_GRACE_HOURS.
 */
export const dynamic = "force-dynamic";

const DEFAULT_RECIPIENTS = [
  "sudheer@inventre.in",
  "sunith@inventre.in",
  "sriram@inventre.in",
];

function timingSafeEq(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function recipients(): string[] {
  const raw = process.env.ALERT_EMAIL;
  if (raw && raw.trim()) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_RECIPIENTS;
}

export async function POST(req: Request) {
  const cfg = getErpConfig();
  if (!cfg.cronToken) {
    return NextResponse.json({ error: "CRON_TOKEN not set" }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !timingSafeEq(supplied, cfg.cronToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const graceHours = Number(process.env.STRANDED_GRACE_HOURS ?? 2);
  const report = await findStrandedOrders(graceHours);

  if (report.strandedCount === 0) {
    return NextResponse.json({ ok: true, stranded: 0, alerted: false });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { ok: false, stranded: report.strandedCount, alerted: false, reason: "no email transport" },
      { status: 200 }
    );
  }

  const to = recipients();
  const subject = `[Inventre] ${report.strandedCount} paid order(s) not synced to audit`;
  const list = report.sample
    .map((n) => `<li>${n}</li>`)
    .join("");
  const more =
    report.strandedCount > report.sample.length
      ? `<p>…and ${report.strandedCount - report.sample.length} more.</p>`
      : "";
  const html = `
    <p><strong>${report.strandedCount}</strong> confirmed + paid order(s) have not
    mirrored to audit.inventre.in (no <code>erp_so_name</code>) for more than
    ${graceHours}h.</p>
    <p>Oldest stranded: <strong>${report.oldest ?? "n/a"}</strong></p>
    <p>Outbound queue — failed: <strong>${report.queueFailed}</strong>, DLQ:
    <strong>${report.dlq}</strong>.</p>
    <p>Order numbers:</p>
    <ul>${list}</ul>
    ${more}
    <p>To recover: reset their <code>erp_outbound_queue</code> rows to
    <code>status='pending', attempts=0</code> — the drain cron re-sends them.</p>
  `;
  const text =
    `${report.strandedCount} paid order(s) not synced to audit for >${graceHours}h.\n` +
    `Oldest: ${report.oldest ?? "n/a"}. Queue failed: ${report.queueFailed}, DLQ: ${report.dlq}.\n` +
    report.sample.join(", ");

  const results = await Promise.allSettled(
    to.map((addr) => sendEmail({ to: addr, subject, html, text }))
  );
  const sent = results.filter(
    (r) => r.status === "fulfilled" && (r.value as { ok?: boolean })?.ok
  ).length;

  // Stamp cooldown timestamp so these orders don't re-alert for 23 h.
  if (sent > 0) {
    await markStrandedAlerted(report.orderIds);
  }

  return NextResponse.json({
    ok: true,
    stranded: report.strandedCount,
    alerted: true,
    recipients: to.length,
    emailsSent: sent,
  });
}
