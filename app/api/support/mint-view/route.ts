import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, students, studentGuardianLinks } from "@/db/schema";
import { isSupportViewEnabled, signSupportView } from "@/lib/support-view";
import { resolveFamilyParent, type FamilyParent } from "@/lib/parent-lookup";
import { last10, last10Sql } from "@/lib/phone";
import { logActivity } from "@/lib/activity";

/** Best-effort client IP from proxy headers; inlined to avoid cross-tree drift. */
function reqIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audit ERP → inventre: mint a short-lived, read-only "view as parent" token.
 *
 * A customer-care agent asks to see student X's storefront exactly as the
 * parent sees it (no OTP). The audit backend POSTs here with a service token;
 * we resolve the inventre parents.id via the SAME guardian-phone authorisation
 * rule as real login, sign a read-only JWT, and return a handoff URL. The
 * agent's browser/iframe opens that URL → the storefront sets an httpOnly
 * cookie and every mutation is blocked at the edge (middleware.ts). Signing
 * stays on inventre, so the audit side never holds the JWT secret.
 *
 * Auth:  Authorization: Bearer <SUPPORT_VIEW_SERVICE_TOKEN>
 * Body:  { studentId?, phone?, agentId, agentName?, supportSessionId?, next?, ttlSeconds? }
 *        (one of studentId | phone is required; agentId is required)
 * 200:   { handoffUrl, token, parentId, studentId, supportSessionId, expiresAt }
 */

function bearerOk(req: NextRequest): boolean {
  const expected = process.env.SUPPORT_VIEW_SERVICE_TOKEN || "";
  if (!expected) return false;
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Resolve the inventre parent row for a studentId, honouring the login rule. */
async function parentForStudent(
  studentId: string,
): Promise<{ parent: FamilyParent | null; studentExists: boolean }> {
  const [stu] = await db
    .select({ id: students.id, parentId: students.parentId })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!stu) return { parent: null, studentExists: false };

  if (stu.parentId) {
    const [p] = await db
      .select()
      .from(parents)
      .where(and(eq(parents.id, stu.parentId), eq(parents.status, "active")))
      .limit(1);
    if (p) return { parent: p, studentExists: true };
  }

  // Unclaimed student (parent_id NULL): fall back to its guardian-link phone
  // and resolve through the same graph login uses.
  const [gl] = await db
    .select({ phoneNo: studentGuardianLinks.phoneNo })
    .from(studentGuardianLinks)
    .where(
      and(
        eq(studentGuardianLinks.studentId, studentId),
        sql`${last10Sql(studentGuardianLinks.phoneNo)} IS NOT NULL`,
      ),
    )
    .limit(1);
  const phone = last10(gl?.phoneNo);
  if (!phone) return { parent: null, studentExists: true };
  return { parent: await resolveFamilyParent(phone), studentExists: true };
}

export async function POST(req: NextRequest) {
  if (!isSupportViewEnabled()) {
    return NextResponse.json({ error: "Support view is disabled" }, { status: 404 });
  }
  if (!bearerOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    studentId?: string;
    phone?: string;
    agentId?: string;
    agentName?: string;
    supportSessionId?: string;
    next?: string;
    ttlSeconds?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const agentId = (body.agentId || "").trim();
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const studentId = (body.studentId || "").trim() || null;
  const phone10 = last10(body.phone);
  if (!studentId && !phone10) {
    return NextResponse.json(
      { error: "Provide studentId or phone" },
      { status: 400 },
    );
  }

  // Resolve the parent to impersonate (whole-account view).
  let parent: FamilyParent | null = null;
  let resolvedStudentId: string | null = studentId;
  if (studentId) {
    const r = await parentForStudent(studentId);
    if (!r.studentExists) {
      return NextResponse.json({ error: "Unknown studentId" }, { status: 404 });
    }
    parent = r.parent;
  } else if (phone10) {
    parent = await resolveFamilyParent(phone10);
  }

  if (!parent) {
    return NextResponse.json(
      { error: "No active parent account is authorised for this student/phone" },
      { status: 404 },
    );
  }

  const minted = await signSupportView({
    parentId: parent.id,
    studentId: resolvedStudentId,
    agentId,
    agentName: body.agentName ?? null,
    supportSessionId: body.supportSessionId ?? null,
    ttlSeconds: body.ttlSeconds,
  });
  if (!minted) {
    return NextResponse.json(
      { error: "Support view secret not configured" },
      { status: 500 },
    );
  }

  // Only allow a relative deep-link path; default into the shop.
  const rawNext = (body.next || "/shop").trim();
  const safeNext =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/shop";

  const base = (process.env.SUPPORT_VIEW_BASE_URL || req.nextUrl.origin).replace(
    /\/+$/,
    "",
  );
  const handoffUrl = `${base}/support-view-handoff?token=${encodeURIComponent(
    minted.token,
  )}&next=${encodeURIComponent(safeNext)}`;
  // Where the agent goes to end the view early. The banner already links here;
  // this is for the audit panel to offer its own "close session" affordance.
  const endUrl = `${base}/support-view/exit`;

  // Audit trail — who viewed which parent, when. Best-effort; never blocks.
  await logActivity({
    action: "support.view.mint",
    actorRole: "support",
    actorName: body.agentName || agentId,
    entityType: "parent",
    entityId: parent.id,
    summary: `Support view-as issued for parent ${parent.id}`,
    remarks: `agent=${agentId} session=${minted.supportSessionId} student=${
      resolvedStudentId ?? "-"
    } jti=${minted.jti}`,
    ip: reqIp(req),
  });

  return NextResponse.json({
    handoffUrl,
    endUrl,
    token: minted.token,
    parentId: parent.id,
    studentId: resolvedStudentId,
    supportSessionId: minted.supportSessionId,
    expiresAt: new Date(minted.exp * 1000).toISOString(),
  });
}
