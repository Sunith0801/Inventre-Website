import "server-only";
import crypto from "crypto";

/**
 * Magic-link token for the Parent Help Portal (inventre.in/portal).
 *
 * A QR code on a parent's package encodes `/portal/enter?t=<token>`. The
 * token is a signed, expiring reference to the parent — opening it
 * establishes that parent's session WITHOUT a login prompt (the QR is the
 * proof of possession). Format (compact, self-verifying):
 *
 *     base64url(JSON {p: parentId, exp: epochSeconds}) "." base64url(HMAC-SHA256)
 *
 * Signed with PORTAL_TOKEN_SECRET (falls back to JWT_SECRET so it works
 * with no extra config). Keep the secret server-side; if Audit ever mints
 * tokens itself it must share this exact secret + format, otherwise it
 * calls the Inventre mint endpoint.
 */

function secret(): string {
  const s = process.env.PORTAL_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error("PORTAL_TOKEN_SECRET / JWT_SECRET not set");
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hmac(body: string): string {
  return b64url(crypto.createHmac("sha256", secret()).update(body).digest());
}

/** Default validity — a QR on a package should keep working for a while. */
export const PORTAL_TOKEN_DEFAULT_TTL_DAYS = 120;

export function signPortalToken(
  parentId: string,
  ttlDays: number = PORTAL_TOKEN_DEFAULT_TTL_DAYS
): string {
  const exp = Math.floor(Date.now() / 1000) + Math.round(ttlDays * 86400);
  const body = b64url(Buffer.from(JSON.stringify({ p: parentId, exp })));
  return `${body}.${hmac(body)}`;
}

/** Returns the parentId if the token is valid + unexpired, else null. */
export function verifyPortalToken(token: string | null | undefined): string | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(body);
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws).
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (!data || typeof data.p !== "string" || typeof data.exp !== "number") return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data.p;
  } catch {
    return null;
  }
}
