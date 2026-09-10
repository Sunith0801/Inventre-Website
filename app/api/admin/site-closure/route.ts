import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { students, systemSettings } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logActivity } from "@/server/activity";
import { parseJson } from "@/server/api-handler";
import { invalidateCatalog } from "@/server/cache";
import {
  SITE_ACCESS_KEY,
  DEFAULT_SITE_ACCESS,
  getSiteAccess,
} from "@/server/site-access";

export const dynamic = "force-dynamic";

/**
 * The one-click storefront Open/Closed switch on /admin/students.
 *
 * Does BOTH halves of a closure in a single call, because splitting them
 * is what confused everyone: the lock (`students.enabled = false` on every
 * student) and the sign on the door (`site.access_closed`, which turns the
 * resulting empty storefront into the "Website Access is Currently Closed"
 * screen). The per-filter buttons still exist under Advanced for surgical
 * school/grade lockouts — this route is deliberately all-or-nothing.
 *
 * BOTH directions are global and absolute, by explicit instruction:
 * closing switches EVERY student off, re-opening switches EVERY student
 * back on. Not a selective restore — ops wanted "master open = everyone
 * shops again", then hand-toggle the exceptions afterwards. So a student
 * disabled individually before a closure DOES come back on at re-open;
 * re-disable them after. (`students.disabled_by_closure` is still stamped
 * as an audit trail of which rows a closure hit, but no longer gates the
 * restore.)
 *
 *   GET  → { closed, affected }   affected = students currently switched off
 *   POST { closed: boolean } → { closed, updated }
 */
const Body = z.object({ closed: z.boolean() });

export async function GET() {
  const guard = await requirePermission("students.read");
  if (isResponse(guard)) return guard;
  const access = await getSiteAccess();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(students)
    .where(eq(students.enabled, false));
  return NextResponse.json({ ...access, affected: row?.n ?? 0 });
}

export async function POST(req: Request) {
  // Shutting the whole storefront is not a school-scoped action — a
  // school_admin holding students.write must not be able to close the
  // site for every other school. They keep the per-filter buttons.
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  if (guard.role === "school_admin") {
    return NextResponse.json(
      { error: "The site-wide switch is restricted to ops and super admins." },
      { status: 403 },
    );
  }
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  const current = await getSiteAccess();

  const updated = (
    await db
      .update(students)
      .set(
        body.closed
          ? { enabled: false, disabledByClosure: true }
          : { enabled: true, disabledByClosure: false },
      )
      // Only the rows that actually differ, so `updated` is a true count.
      .where(eq(students.enabled, body.closed))
      .returning({ id: students.id })
  ).length;

  const value = {
    closed: body.closed,
    title: current.title || DEFAULT_SITE_ACCESS.title,
    subtitle: current.subtitle || DEFAULT_SITE_ACCESS.subtitle,
  };
  await db
    .insert(systemSettings)
    .values({ key: SITE_ACCESS_KEY, value })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedAt: new Date() },
    });

  await invalidateCatalog();
  revalidatePath("/admin/students");

  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: body.closed ? "site.closed" : "site.opened",
    entityType: "settings",
    entityId: "site-closure",
    summary: body.closed
      ? `CLOSED the storefront — disabled ${updated} students site-wide`
      : `RE-OPENED the storefront — restored ${updated} students`,
    diff: { closed: body.closed, students: updated },
  });

  return NextResponse.json({ closed: body.closed, updated });
}
