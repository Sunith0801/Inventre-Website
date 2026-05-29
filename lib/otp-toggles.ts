import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { systemSettings } from "@/db/schema";

export const SMS_REAL_SEND_KEY = "otp.sms_real_send";
export const EMAIL_REAL_SEND_KEY = "otp.email_real_send";

export type OtpToggles = {
  smsRealSend: boolean;
  emailRealSend: boolean;
};

function coerceBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v !== 0;
  return fallback;
}

export async function getOtpToggles(): Promise<OtpToggles> {
  // Default both to ON in production-like environments (real sends) so that an
  // empty system_settings row never silently disables OTP delivery. The admin
  // can flip them off explicitly via /admin/settings/otp.
  const rows = await db
    .select()
    .from(systemSettings)
    .where(inArray(systemSettings.key, [SMS_REAL_SEND_KEY, EMAIL_REAL_SEND_KEY]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    smsRealSend: coerceBool(map.get(SMS_REAL_SEND_KEY), true),
    emailRealSend: coerceBool(map.get(EMAIL_REAL_SEND_KEY), true),
  };
}

export function getBypassOtp(): string {
  const code = process.env.OTP_BYPASS_CODE;
  if (!code) {
    throw new Error(
      "OTP_BYPASS_CODE is not set. Configure it in .env.deploy to use bypass mode."
    );
  }
  return code;
}
