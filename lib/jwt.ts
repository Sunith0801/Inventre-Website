import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export type SessionPayload = {
  sub: string;
  kind: "parent" | "admin" | "fees";
  schoolId?: string;
  role?: "super" | "ops" | "school_admin";
  // Parent sessions only: the phone the user actually authenticated with.
  // Drives per-guardian UI (e.g. welcome name) when several phones share
  // one parents row via the multi-guardian phone graph.
  phone?: string;
};

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

function getKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Copy .env.example to .env.local and set a 32+ byte secret."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .sign(getKey());
}

export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// Two independent cookies so an admin and a parent session can coexist in
// the same browser without overwriting each other. `inv_session` predates
// the split and is kept for parents to avoid invalidating live sessions.
export const SESSION_COOKIE = "inv_session";
export const ADMIN_SESSION_COOKIE = "inv_admin";
/**
 * Fee-ledger session — deliberately a THIRD cookie rather than a small-
 * permission admin session. A fee-desk login is then not an admin at all:
 * `kind` is checked against the area, so admin guards reject this token
 * outright, and the admin pages that carry no permission guard of their own
 * stop being reachable by these accounts. It also lets one browser hold an
 * admin login and a fee-desk login at the same time.
 */
export const FEES_SESSION_COOKIE = "inv_fees";
export const SESSION_MAX_AGE = SESSION_TTL;
