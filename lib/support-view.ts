import "server-only";
import { cookies, headers } from "next/headers";
import { jwtVerify } from "jose";

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

/** Server-component / route-handler view of the current support-view context. */
export async function readSupportView(): Promise<SupportViewPayload | null> {
  if (!isSupportViewEnabled()) return null;
  // Middleware sets a request header when it has already verified the cookie,
  // so server components can skip the JWT round-trip.
  const h = await headers();
  const flag = h.get(SUPPORT_VIEW_HEADER);
  if (flag) {
    try {
      return JSON.parse(
        Buffer.from(flag, "base64url").toString("utf8"),
      ) as SupportViewPayload;
    } catch {
      // fall through to cookie path
    }
  }
  const jar = await cookies();
  const tok = jar.get(SUPPORT_VIEW_COOKIE)?.value;
  if (!tok) return null;
  return verifySupportView(tok);
}
