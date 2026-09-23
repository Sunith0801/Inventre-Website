import crypto from "node:crypto";

/**
 * OTP codes in `otp_logs` are kept only so support staff can help a parent
 * who says "the SMS never came" — but a plain-text copy of every code ever
 * sent is a liability (Data Protection plan P-01). Codes are therefore
 * sealed with AES-256-GCM before they hit the table and shown in the admin
 * OTP Logs page only through an explicit Reveal that needs a key phrase.
 *
 *   OTP_LOG_KEY        — 32+ random bytes (hex). Encrypts / decrypts.
 *                        Unset ⇒ the code is NOT stored at all (safe default).
 *   OTP_REVEAL_PHRASE  — the phrase support staff type to reveal a code.
 *                        Unset ⇒ Reveal is disabled.
 *
 * Stored format: `enc:<iv>:<tag>:<ciphertext>` (base64url). A bare 4–8 digit
 * value is a legacy plain-text row from before this module existed; the
 * backfill script (`scripts/otp-logs-seal-legacy.ts`) converts those.
 */

const PREFIX = "enc:";

function key(): Buffer | null {
  const raw = process.env.OTP_LOG_KEY?.trim();
  if (!raw || raw.length < 32) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

/** Encrypt a code for storage. Returns null when no key is configured. */
export function sealOtpCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const k = key();
  if (!k) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

export function isSealed(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}

/** Decrypt a stored value. Legacy plain-text rows are returned as-is. */
export function openOtpCode(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!isSealed(stored)) return stored;
  const k = key();
  if (!k) return null;
  const [, ivB, tagB, ctB] = stored.split(":");
  if (!ivB || !tagB || !ctB) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Constant-time check of the reveal phrase typed by a staff member. */
export function checkRevealPhrase(phrase: string | null | undefined): boolean {
  const expected = process.env.OTP_REVEAL_PHRASE?.trim();
  if (!expected || !phrase) return false;
  const a = Buffer.from(phrase.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function revealEnabled(): boolean {
  return !!process.env.OTP_REVEAL_PHRASE?.trim() && !!key();
}
