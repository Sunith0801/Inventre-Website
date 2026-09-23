import { SignJWT, jwtVerify } from "jose";
import { getVerifyKeys } from "@/lib/jwt";

/**
 * P-16: the public support portal's photo upload used to accept files from
 * anyone. Now the SEARCH step (which every visitor performs first) issues a
 * short-lived ticket bound to the family it found, and the upload route
 * refuses requests without one. Same HS256 key as sessions; the `kind`
 * claim keeps a ticket from ever passing as a session and vice-versa.
 */
const TTL_SECONDS = 30 * 60;
const KIND = "portal-upload";

export async function issuePortalTicket(parentId: string): Promise<string> {
  const [key] = getVerifyKeys();
  return new SignJWT({ kind: KIND, pid: parentId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyPortalTicket(token: string | null | undefined): Promise<{ parentId: string } | null> {
  if (!token) return null;
  for (const key of getVerifyKeys()) {
    try {
      const { payload } = await jwtVerify(token, key);
      if (payload.kind !== KIND || typeof payload.pid !== "string") return null;
      return { parentId: payload.pid };
    } catch {
      // try the previous key
    }
  }
  return null;
}
