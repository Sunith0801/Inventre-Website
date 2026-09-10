import "server-only";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";

export const SUPPORT_VIEW_COOKIE = "inv_support_view";
export const SUPPORT_VIEW_HEADER = "x-inv-support-view";

export type SupportViewPayload = {
  parentId: string;
  studentId: string | null;
  agentId: string;
  agentName: string | null;
  supportSessionId: string;
  scope: "read";
  jti: string;
  exp: number;
};

let KEY: Uint8Array | null = null;
function key(): Uint8Array | null {
  if (KEY) return KEY;
  const s = process.env.SUPPORT_VIEW_JWT_SECRET;
  if (!s) return null;
  KEY = new TextEncoder().encode(s);
  return KEY;
}

export function isSupportViewEnabled(): boolean {
  return process.env.SUPPORT_VIEW_ENABLED === "true";
}

export type MintSupportViewInput = {
  parentId: string;
  studentId?: string | null;
  agentId: string;
  agentName?: string | null;
  supportSessionId?: string | null;
  /** Token lifetime in seconds. Clamped to [60, 3600]. Default 900 (15 min). */
  ttlSeconds?: number;
};

export type MintedSupportView = {
  token: string;
  jti: string;
  supportSessionId: string;
  /** Absolute expiry (unix seconds). */
  exp: number;
};

/**
 * Sign a short-lived, read-only support-view JWT. Minted on the storefront
 * (inventre) so the signing secret never has to leave this side — the audit
 * ERP just calls the authenticated mint endpoint and receives a handoff URL.
 * Returns null when the feature is disabled or the secret is unset.
 */
export async function signSupportView(
  input: MintSupportViewInput,
): Promise<MintedSupportView | null> {
  if (!isSupportViewEnabled()) return null;
  const k = key();
  if (!k) return null;
  const ttl = Math.min(3600, Math.max(60, Math.floor(input.ttlSeconds ?? 900)));
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttl;
  const jti = crypto.randomUUID();
  const supportSessionId = input.supportSessionId || crypto.randomUUID();
  const payload: SupportViewPayload = {
    parentId: input.parentId,
    studentId: input.studentId ?? null,
    agentId: input.agentId,
    agentName: input.agentName ?? null,
    supportSessionId,
    scope: "read",
    jti,
    exp,
  };
  const token = await new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(k);
  return { token, jti, supportSessionId, exp };
}

/** Verify a raw JWT against SUPPORT_VIEW_JWT_SECRET. Returns payload or null. */
export async function verifySupportView(
  token: string,
): Promise<SupportViewPayload | null> {
  if (!isSupportViewEnabled()) return null;
  const k = key();
  if (!k) return null;
  try {
    const { payload } = await jwtVerify(token, k, { algorithms: ["HS256"] });
    if (
      typeof payload.parentId === "string" &&
      typeof payload.agentId === "string" &&
      typeof payload.supportSessionId === "string" &&
      typeof payload.jti === "string" &&
      payload.scope === "read"
    ) {
      return payload as unknown as SupportViewPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Server-component / route-handler view of the current support-view context.
 *
 * Reads the cookie and cryptographically verifies its JWT on every call — this
 * is the ONLY trusted source. An earlier version also honoured an
 * `x-inv-support-view` request header (set by middleware to skip the verify
 * round-trip), but that header was trusted *unsigned*: any client could send
 * it, and it reached this function directly on routes outside middleware's
 * matcher (e.g. /api/shop/*), letting an attacker impersonate any parent by id.
 * The header fast-path is gone; HS256 verify is cheap and getSession() is
 * React.cache-wrapped, so the per-request cost is negligible.
 */
export async function readSupportView(): Promise<SupportViewPayload | null> {
  if (!isSupportViewEnabled()) return null;
  const jar = await cookies();
  const tok = jar.get(SUPPORT_VIEW_COOKIE)?.value;
  if (!tok) return null;
  return verifySupportView(tok);
}
