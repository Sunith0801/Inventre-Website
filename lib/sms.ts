/**
 * OTP SMS via Arihant Global HTTP API.
 * Dev fallback (no SMS_API_USERNAME): logs to console, no real SMS sent.
 *
 * Prod env vars: SMS_API_URL, SMS_API_USERNAME, SMS_API_PASSWORD
 */

const DLT_TEMPLATE_ID = "380462";
const DLT_CONTENT_ID = "1107173978479110904";
const SENDER_ID = "IESPL";

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
    // eslint-disable-next-line no-console
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

  const res = await fetch(`${baseUrl}?${params}`);
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
    // Non-OTP message — no matching DLT template yet, skip silently.
    return { ok: true as const, transactionId: "skipped", dev: true };
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
