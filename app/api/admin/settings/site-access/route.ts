import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { systemSettings } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";
import { parseBody } from "@/lib/parse-body";
import {
  SITE_ACCESS_KEY,
  DEFAULT_SITE_ACCESS,
  getSiteAccess,
} from "@/lib/site-access";

export const dynamic = "force-dynamic";

/**
 * The storefront-closure switch behind the "Website closed" banner on
 * /admin/students. Gated on students.write because that's the page it
 * lives on and the people who run the lockout are the same people who
 * flip students.enabled — no new permission slug to grant.
 */
const Body = z.object({
  closed: z.boolean(),
  title: z.string().trim().min(1).max(120).optional(),
  subtitle: z.string().trim().min(1).max(200).optional(),
});

export async function GET() {
  const guard = await requirePermission("students.read");
  if (isResponse(guard)) return guard;
  return NextResponse.json(await getSiteAccess());
}

export async function PUT(req: Request) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;

  const current = await getSiteAccess();
  const value = {
    closed: parsed.closed,
    title: parsed.title ?? current.title ?? DEFAULT_SITE_ACCESS.title,
    subtitle: parsed.subtitle ?? current.subtitle ?? DEFAULT_SITE_ACCESS.subtitle,
  };

  await db
    .insert(systemSettings)
    .values({ key: SITE_ACCESS_KEY, value })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedAt: new Date() },
    });

  void logAdminActivity(guard, {
    action: "settings.update",
    entityType: "settings",
    entityId: "site-access",
    summary: parsed.closed
      ? "Closed storefront access (students without Enabled see the closed screen)"
      : "Re-opened storefront access",
    diff: { before: current, after: value },
    req,
  });

  return NextResponse.json(value);
}
