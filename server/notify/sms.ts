/**
 * OTP SMS via Arihant Global HTTP API.
 * Dev fallback (no SMS_API_USERNAME): logs to console, no real SMS sent.
 *
 * Prod env vars: SMS_API_URL, SMS_API_USERNAME, SMS_API_PASSWORD
 */

const DLT_TEMPLATE_ID = "380462";
const DLT_CONTENT_ID = "1107173978479110904";
const SENDER_ID = "IESPL";

const SMS_TIMEOUT_MS = 8000;
const SMS_ATTEMPTS = 2;
const SMS_RETRY_DELAY_MS = 400;

/**
 * POST to the gateway with a per-attempt timeout and one retry. Transient
 * network failures ("fetch failed") were ~99% of our send_failed logs and
 * almost always succeed on an immediate retry; without a timeout a hung
 * connection would block the request indefinitely.
 */
async function fetchSms(url: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < SMS_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(SMS_TIMEOUT_MS) });
    } catch (err) {
      lastErr = err;
      if (attempt < SMS_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, SMS_RETRY_DELAY_MS));
      }
    }
  }
  throw lastErr;
}

export async function sendOtpSms(
  phone: string,
  otp: string
): Promise<{ ok: true; transactionId: string; dev?: boolean }> {
  const username = process.env.SMS_API_USERNAME;
  const password = process.env.SMS_API_PASSWORD;
  const baseUrl =
    process.env.SMS_API_URL ??
    "https://control.arihantglobal.in/fe/api/v1/send";

  const text = `Your OTP for Inventre Login is ${otp}. Please do not share this OTP with anyone. It is valid for 5 minutes. - INVENTRE EDUSERVICES PVT. LTD`;

  if (!username || !password) {
     
    console.log(`\n📱 [DEV SMS to +91${phone}] → ${text}\n`);
    return { ok: true, transactionId: "dev", dev: true };
  }

  const params = new URLSearchParams({
    username,
    password,
    unicode: "false",
    from: SENDER_ID,
    to: `91${phone}`,
    text,
    templateId: DLT_TEMPLATE_ID,
    dltContentId: DLT_CONTENT_ID,
  });

  const res = await fetchSms(`${baseUrl}?${params}`);
  // Vendor returns JSON even on errors
  const json = (await res.json()) as {
    transactionId?: number;
    state?: string;
    description?: string;
  };

  if (json.state !== "SUBMIT_ACCEPTED") {
    throw new Error(
      json.description ?? `SMS send failed: state=${json.state ?? res.status}`
    );
  }

  return { ok: true, transactionId: String(json.transactionId) };
}

/**
 * Order-placed confirmation SMS (DLT template "Order Confirmation New").
 * Skeleton must match the registered template byte-for-byte or the operator
 * silently drops the message even after SUBMIT_ACCEPTED:
 *
 *   Dear {#var#}, Your Order has been successful with Order ID {#var#}. You
 *   will receive updates once it is processed. You can also track your order
 *   here {#var#} -INVENTRE EDU SERVICES PVT LTD
 *
 * (Single spaces throughout; a space precedes the literal "-INVENTRE EDU
 * SERVICES PVT LTD" footer — all part of the registered skeleton and must
 * survive any edit here.)
 *
 * DLT variables are capped at 30 chars — the full name is used (fallback
 * "Customer") truncated to 30, the order number is truncated, and var3
 * carries the tracking link as a bare domain (the full https:// URL is 31
 * chars).
 *
 * Credentials: SMS_TRANS_API_USERNAME/PASSWORD when the transactional
 * account differs from the OTP one, else the shared SMS_API_USERNAME/
 * PASSWORD. Dev fallback (neither set): console log, no real SMS.
 */
const ORDER_CONFIRM_TEMPLATE_ID = "456421";
const ORDER_CONFIRM_DLT_CONTENT_ID = "1107178133323580821";

export async function sendOrderConfirmationSms(
  phone: string,
  parentName: string | null,
  orderNumber: string
): Promise<{ ok: true; transactionId: string; dev?: boolean; text: string }> {
  const username =
    process.env.SMS_TRANS_API_USERNAME ?? process.env.SMS_API_USERNAME;
  const password =
    process.env.SMS_TRANS_API_PASSWORD ?? process.env.SMS_API_PASSWORD;
  const baseUrl =
    process.env.SMS_API_URL ??
    "https://control.arihantglobal.in/fe/api/v1/send";

  // DLT variables cap at 30 chars; use the full name (collapsing internal
  // whitespace) truncated to fit, not just the first word.
  const var1 = (
    parentName?.trim().replace(/\s+/g, " ") || "Customer"
  ).slice(0, 30);
  const var2 = orderNumber.slice(0, 30);
  const var3 = "inventre.in/shop/orders";
  const text = `Dear ${var1}, Your Order has been successful with Order ID ${var2}. You will receive updates once it is processed. You can also track your order here ${var3} -INVENTRE EDU SERVICES PVT LTD`;

  if (!username || !password) {
     
    console.log(`\n📱 [DEV SMS to +91${phone}] → ${text}\n`);
    return { ok: true, transactionId: "dev", dev: true, text };
  }

  const params = new URLSearchParams({
    username,
    password,
    unicode: "false",
    from: SENDER_ID,
    to: `91${phone}`,
    text,
    templateId: ORDER_CONFIRM_TEMPLATE_ID,
    dltContentId: ORDER_CONFIRM_DLT_CONTENT_ID,
  });

  const res = await fetchSms(`${baseUrl}?${params}`);
  const json = (await res.json()) as {
    transactionId?: number;
    state?: string;
    description?: string;
  };

  if (json.state !== "SUBMIT_ACCEPTED") {
    throw new Error(
      json.description ?? `SMS send failed: state=${json.state ?? res.status}`
    );
  }

  return { ok: true, transactionId: String(json.transactionId), text };
}

/**
 * @deprecated Legacy shim for routes that haven't migrated to sendOtpSms().
 * Only routes sending OTPs (with variables.otp) will actually send SMS;
 * other callers (order notifications etc.) are no-ops until they get their
 * own DLT templates.
 */
export async function sendSms({
  phone,
  variables,
}: {
  phone: string;
  body: string;
  templateId?: string;
  variables?: Record<string, string>;
}) {
  const otp = variables?.otp ?? variables?.code;
  if (!otp) {
    // Non-OTP message — no approved DLT template on the transactional
    // gateway yet, so nothing is sent. Say so in the log instead of
    // pretending (F-09): callers record `transactionId: "skipped"` and no
    // customer copy promises an SMS any more.
    console.warn(`[sms] skipped non-OTP message to +91${phone} — no transactional DLT template configured`);
    return { ok: true as const, transactionId: "skipped", dev: true, skipped: "no-transactional-template" as const };
  }
  return sendOtpSms(phone, otp);
}

export function generateOtp(): string {
  if (!process.env.SMS_API_USERNAME) {
    const bypass = process.env.DEV_OTP ?? process.env.OTP_BYPASS_CODE;
    if (!bypass) {
      throw new Error(
        "No SMS provider configured and OTP_BYPASS_CODE is unset — refusing to generate an OTP."
      );
    }
    return bypass;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}
