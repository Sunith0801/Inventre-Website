import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { requirePermission, isResponse } from "@/server/admin-guard";
import { signPortalToken, PORTAL_TOKEN_DEFAULT_TTL_DAYS } from "@/server/portal-token";

/**
 * Mint a Parent Help Portal magic-link (admin-gated).
 *
 *   POST /api/portal/token  { parentId?, phone?, ttlDays? }
 *   → { token, url, parentId, expiresInDays }
 *
 * The `url` is what the QR code should encode — opening it logs the parent
 * into /portal with no password. Resolve by parentId (uuid) or phone (last
 * 10 digits). Audit's QR generator can call this (with an admin/service
 * credential) per parent, or mint locally if it shares PORTAL_TOKEN_SECRET.
 */

export const dynamic = "force-dynamic";

const Body = z.object({
  parentId: z.string().uuid().optional(),
  phone: z.string().min(6).optional(),
  ttlDays: z.number().int().positive().max(3650).optional(),
});

/** Convenience GET so an admin can grab a link from the browser:
 *  /api/portal/token?phone=7013232148  (or ?parentId=…&ttlDays=…). */
export async function GET(req: Request) {
  const guard = await requirePermission("orders.write");
  if (isResponse(guard)) return guard;
  const sp = new URL(req.url).searchParams;
  const ttlRaw = sp.get("ttlDays");
  return mint(req, {
    parentId: sp.get("parentId") ?? undefined,
    phone: sp.get("phone") ?? undefined,
    ttlDays: ttlRaw ? Number(ttlRaw) : undefined,
  });
}

export async function POST(req: Request) {
  const guard = await requirePermission("orders.write");
  if (isResponse(guard)) return guard;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  return mint(req, body);
}

async function mint(req: Request, body: z.infer<typeof Body>) {
  if (!body.parentId && !body.phone) {
    return NextResponse.json({ error: "Provide parentId or phone" }, { status: 400 });
  }

  let parentId = body.parentId ?? null;
  if (!parentId && body.phone) {
    const last10 = body.phone.replace(/\D/g, "").slice(-10);
    const [row] = await db
      .select({ id: parents.id })
      .from(parents)
      .where(sql`right(regexp_replace(${parents.phone}, '\\D', '', 'g'), 10) = ${last10}`)
      .limit(1);
    if (!row) {
      return NextResponse.json({ error: `No parent for phone ${body.phone}` }, { status: 404 });
    }
    parentId = row.id;
  }

  const ttlDays =
    typeof body.ttlDays === "number" && Number.isFinite(body.ttlDays) && body.ttlDays > 0
      ? body.ttlDays
      : PORTAL_TOKEN_DEFAULT_TTL_DAYS;
  const token = signPortalToken(parentId!, ttlDays);
  // Public origin from forwarded headers — req.url's host is the internal
  // container bind (0.0.0.0:3000) behind nginx, which would make a dead link.
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const origin = `${proto}://${host}`;
  return NextResponse.json({
    parentId,
    token,
    url: `${origin}/portal/enter?t=${token}`,
    expiresInDays: ttlDays,
  });
}
