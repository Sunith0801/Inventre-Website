import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE, ADMIN_SESSION_COOKIE, FEES_SESSION_COOKIE } from "@/lib/jwt";

const SUPPORT_VIEW_COOKIE = "inv_support_view";
const SUPPORT_VIEW_HEADER = "x-inv-support-view";

const SUPPORT_KEY_CACHE: { key: Uint8Array | null } = { key: null };
function supportViewKey(): Uint8Array | null {
  if (SUPPORT_KEY_CACHE.key) return SUPPORT_KEY_CACHE.key;
  const s = process.env.SUPPORT_VIEW_JWT_SECRET;
  if (!s) return null;
  SUPPORT_KEY_CACHE.key = new TextEncoder().encode(s);
  return SUPPORT_KEY_CACHE.key;
}

type SupportViewMini = {
  parentId: string;
  studentId: string | null;
  agentId: string;
  agentName: string | null;
  supportSessionId: string;
  scope: "read";
  jti: string;
  exp: number;
};

async function readSupportView(req: NextRequest): Promise<SupportViewMini | null> {
  if (process.env.SUPPORT_VIEW_ENABLED !== "true") return null;
  const tok = req.cookies.get(SUPPORT_VIEW_COOKIE)?.value;
  if (!tok) return null;
  const k = supportViewKey();
  if (!k) return null;
  try {
    const { payload } = await jwtVerify(tok, k, { algorithms: ["HS256"] });
    if (
      typeof payload.parentId === "string" &&
      typeof payload.agentId === "string" &&
      typeof payload.supportSessionId === "string" &&
      typeof payload.jti === "string" &&
      payload.scope === "read"
    ) {
      return payload as unknown as SupportViewMini;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Edge middleware — cheap pre-DB rejection. Verifies JWT signature only;
 * full hydration (DB lookup + role check) still happens in route handlers
 * via getCurrentUser/requireAdmin/requireParent.
 *
 * Goals:
 *   - block unauthenticated requests at /admin/* and /shop/{cart,checkout,orders}
 *   - block unauthenticated API calls under /api/admin/* and /api/orders/*, /api/returns,
 *     /api/addresses, /api/cart, /api/reviews, /api/checkout/*
 *   - reject admin tokens hitting parent surfaces and vice versa
 */

type Kind = "parent" | "admin";
type Mini = { sub: string; kind: Kind; role?: string };

const KEY_CACHE: { key: Uint8Array | null } = { key: null };
function key() {
  if (KEY_CACHE.key) return KEY_CACHE.key;
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set");
  KEY_CACHE.key = new TextEncoder().encode(s);
  return KEY_CACHE.key;
}

/**
 * Read the cookie that matches the requested area. Admin and parent
 * sessions live in separate cookies (`inv_admin` and `inv_session`) so a
 * parent OTP flow doesn't clobber an admin login in the same browser.
 */
async function readSession(
  req: NextRequest,
  area: "admin" | "parent" | "fees"
): Promise<Mini | null> {
  const cookieName =
    area === "admin"
      ? ADMIN_SESSION_COOKIE
      : area === "fees"
        ? FEES_SESSION_COOKIE
        : SESSION_COOKIE;
  const tok = req.cookies.get(cookieName)?.value;
  if (!tok) return null;
  try {
    const { payload } = await jwtVerify(tok, key());
    const mini = payload as unknown as Mini;
    // Defense in depth: refuse a wrong-kind token even if it ended up in
    // the wrong cookie somehow.
    if (mini.kind !== area) return null;
    return mini;
  } catch {
    return null;
  }
}

function deny(req: NextRequest, kind: "page" | "api", to?: string) {
  if (kind === "api")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = to ?? "/login";
  url.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

const PARENT_PAGE_PREFIXES = ["/shop"];
const ADMIN_PAGE_PREFIX = "/admin";
const ADMIN_LOGIN_PAGE = "/admin/login";
const ADMIN_PUBLIC_PAGES = new Set([
  ADMIN_LOGIN_PAGE,
  "/admin/forgot-password",
  "/admin/reset-password",
]);
const PARENT_API_PREFIXES = [
  "/api/orders",
  "/api/returns",
  "/api/addresses",
  "/api/cart",
  "/api/reviews",
  "/api/checkout",
];
const ADMIN_API_PREFIX = "/api/admin";

/**
 * CSRF check for state-changing API requests.
 * Cookies use sameSite=lax which already blocks cross-site form POSTs to
 * non-GET endpoints, but we add an explicit Origin/Referer same-host check
 * for defense in depth on JSON-API surfaces. Webhook routes (no cookies, no
 * session) are excluded — they use signature verification instead.
 */
const CSRF_API_PREFIXES = [
  "/api/admin/",
  "/api/fees/",
  "/api/auth/",
  "/api/cart",
  "/api/orders",
  "/api/returns",
  "/api/addresses",
  "/api/reviews",
  "/api/checkout",
];
const CSRF_EXCLUDE_PREFIXES = [
  "/api/webhooks",
  // CCAvenue posts the encrypted callback from its own hosted page. The
  // browser-initiated redirect has Origin=test.ccavenue.com (or
  // www.ccavenue.com in live), which won't match our host. Authenticity is
  // verified by AES decryption inside the route, not by Origin/Referer.
  "/api/checkout/ccavenue/callback",
];
/** Endpoints the fee ledger calls, reachable with a fee-ledger session. */
const FEES_API_PREFIXES = [
  "/api/admin/mcb/fees",
  "/api/admin/fees/",
];

function isMutation(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}
function checkCsrf(req: NextRequest): boolean {
  const path = req.nextUrl.pathname;
  if (CSRF_EXCLUDE_PREFIXES.some((p) => path.startsWith(p))) return true;
  const needsCheck =
    path.startsWith("/api/") &&
    isMutation(req.method) &&
    CSRF_API_PREFIXES.some((p) => path === p || path.startsWith(p));
  if (!needsCheck) return true;
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  if (!host) return false;
  const candidate = origin ?? referer;
  if (!candidate) {
    // No Origin/Referer on a same-origin fetch is unusual; reject to be safe.
    return false;
  }
  try {
    const u = new URL(candidate);
    return u.host === host;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // ── Support view-as guard ─────────────────────────────────────────
  // When a valid support-view cookie is present, the request is being driven
  // by a support agent impersonating a parent for READ-ONLY diagnosis.
  // Block every mutation; let GET/HEAD/OPTIONS through with a request header
  // that downstream server code reads via lib/support-view.ts.
  // Strip any client-supplied copy of the internal support-view header up front.
  // App code (lib/support-view.ts) no longer trusts this header — it verifies
  // the signed cookie instead — but we still refuse to let an inbound value
  // survive, so nothing downstream can ever be fooled by a forged header.
  // Headers.has/delete are case-insensitive (Fetch spec), so this catches any
  // casing a client might send.
  let cleanHeaders: Headers | null = null;
  if (req.headers.has(SUPPORT_VIEW_HEADER)) {
    cleanHeaders = new Headers(req.headers);
    cleanHeaders.delete(SUPPORT_VIEW_HEADER);
  }
  const forward = () =>
    cleanHeaders
      ? NextResponse.next({ request: { headers: cleanHeaders } })
      : NextResponse.next();

  const supportView = await readSupportView(req);
  if (supportView) {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      return NextResponse.json(
        { error: "Read-only support view: mutations are disabled." },
        { status: 403 },
      );
    }
    return forward();
  }

  if (path.startsWith("/api/") && !checkCsrf(req)) {
    return NextResponse.json({ error: "Forbidden (CSRF)" }, { status: 403 });
  }

  // Admin pages (the sign-in door and the forgot-password pages are public)
  if (path.startsWith(ADMIN_PAGE_PREFIX) && !ADMIN_PUBLIC_PAGES.has(path)) {
    const me = await readSession(req, "admin");
    if (!me) return deny(req, "page", "/admin/login");
    return NextResponse.next();
  }

  // Parent pages
  if (PARENT_PAGE_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) {
    const me = await readSession(req, "parent");
    if (!me) return deny(req, "page", "/login");
    return NextResponse.next();
  }

  // Fee-ledger API. These endpoints live under /api/admin/ for historical
  // reasons but are served to fee-desk accounts, whose session is NOT an
  // admin one — so the admin gate below would reject them. Presence of
  // either session is enough here; the route handlers do the real
  // permission check via getFeesViewer().
  if (FEES_API_PREFIXES.some((p) => path.startsWith(p))) {
    const admin = await readSession(req, "admin");
    const fees = admin ? null : await readSession(req, "fees");
    if (!admin && !fees) return deny(req, "api");
    return forward();
  }

  // Admin API
  if (path.startsWith(ADMIN_API_PREFIX) && !path.startsWith("/api/admin/auth")) {
    const me = await readSession(req, "admin");
    if (!me) return deny(req, "api");
    return NextResponse.next();
  }

  // Parent API
  if (PARENT_API_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) {
    // CCAvenue posts back from its own domain. Cookies on SameSite=Lax
    // mostly survive that POST, but not always — and the callback
    // authenticates by AES-decrypting `encResp`, not by user session.
    if (path === "/api/checkout/ccavenue/callback") return NextResponse.next();
    const me = await readSession(req, "parent");
    if (!me) return deny(req, "api");
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/shop/:path*",
    "/shop",
    // Skip /api/admin/upload — it accepts multipart bodies up to 500 MB.
    // Next 15.5 silently caps middleware-matched routes at 10 MB and the
    // route handler then fails with "Failed to parse body as FormData."
    // Auth is still enforced inside the route via requireAdmin().
    "/api/admin/((?!upload).*)",
    "/api/fees/:path*",
    "/api/orders/:path*",
    "/api/orders",
    // Skip /api/returns/upload — exchange photo uploads are multipart bodies
    // that can exceed Next 15.5's silent 10 MB middleware-body cap. Past the
    // cap the body is truncated and the route's req.formData() fails, surfacing
    // as a 400 (or the request times out → 499/408 → "Failed to fetch" on the
    // client). Same fix as /api/admin/upload above; auth is still enforced
    // inside the route via requireParent().
    "/api/returns/((?!upload).*)",
    "/api/returns",
    "/api/addresses/:path*",
    "/api/addresses",
    "/api/cart/:path*",
    "/api/cart",
    "/api/reviews/:path*",
    "/api/reviews",
    "/api/checkout/:path*",
    "/api/auth/:path*",
  ],
};
