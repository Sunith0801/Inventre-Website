import "server-only";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/jwt";

/**
 * Best-effort parent id extraction from a raw Cookie header. Used by the
 * instrumentation hook to attribute 5xx errors to a parent without re-running
 * the full DB hydration. Returns null on any failure — never throws.
 */
export async function cookieToParentId(rawCookies: string): Promise<string | null> {
  const map = new Map<string, string>();
  for (const part of rawCookies.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    map.set(k, decodeURIComponent(rest.join("=")));
  }
  const tok = map.get(SESSION_COOKIE);
  if (!tok) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(tok, new TextEncoder().encode(secret));
    if (payload.kind === "parent" && typeof payload.sub === "string") {
      return payload.sub;
    }
  } catch {
    // fall through
  }
  return null;
}
