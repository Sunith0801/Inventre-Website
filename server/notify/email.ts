import "server-only";

/**
 * Email transport. Three layers — first one whose env is set wins:
 *
 *   1. SMTP (nodemailer) — preferred. Used by mobile-recovery email OTPs.
 *      Requires SMTP_HOST, SMTP_USER, SMTP_PASS (optional SMTP_PORT, default 587).
 *   2. Resend HTTP — RESEND_API_KEY.
 *   3. Console log (dev fallback).
 *
 * Switching transports doesn't require call-site changes; everyone goes
 * through sendEmail().
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST || process.env.RESEND_API_KEY);
}

/**
 * Show enough of an email to be recognisable without leaking the full
 * address. "bheem@inventre.in" → "bhe****m@inventre.in". Keeps the first
 * three local-part chars and the very last char before the @, masking the
 * middle. Very short local parts (≤ 3 chars) are masked entirely.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 3) return "•".repeat(local.length) + domain;
  const head = local.slice(0, 3);
  const tail = local.slice(-1);
  return `${head}${"•".repeat(Math.max(3, local.length - 4))}${tail}${domain}`;
}

async function sendViaSmtp(msg: EmailMessage): Promise<{
  ok: boolean;
  id?: string;
  error?: string;
}> {
  try {
    // Dynamic import keeps the type-only path light, and lets dev environments
    // that haven't installed nodemailer yet still compile/start.
    const mod = await import("nodemailer");
    const nodemailer = mod.default ?? mod;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 = implicit TLS; 587/25 = STARTTLS upgrade.
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    const info = await transport.sendMail({
      from: process.env.EMAIL_FROM ?? `Inventre <${process.env.SMTP_USER}>`,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendViaResend(msg: EmailMessage): Promise<{
  ok: boolean;
  id?: string;
  error?: string;
}> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Inventre <noreply@inventre.in>",
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `resend ${res.status}: ${t.slice(0, 200)}` };
    }
    const j = (await res.json()) as { id?: string };
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendEmail(msg: EmailMessage): Promise<{
  ok: boolean;
  id?: string;
  error?: string;
}> {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return sendViaSmtp(msg);
  }
  if (process.env.RESEND_API_KEY) {
    return sendViaResend(msg);
  }
  if (process.env.NODE_ENV !== "production") {
     
    console.log("[email:stub]", msg.to, "—", msg.subject);
  }
  return { ok: false, error: "No email transport configured" };
}
