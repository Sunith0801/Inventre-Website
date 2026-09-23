import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { getCurrentUser, getCurrentParent } from "@/server/session";
import { parseJson } from "@/server/api-handler";

export async function GET(req: Request) {
  // Prefer the parent session. `getCurrentUser` resolves an admin cookie
  // first, which would shadow a logged-in parent (e.g. someone who also
  // used the admin panel in the same browser) and blank the shop's
  // student banner. This endpoint feeds parent-facing UI only.
  const parent = await getCurrentParent();
  const user = parent ?? (await getCurrentUser());
  // Data minimisation (Data Protection P-05): a child's date of birth is
  // only shown on /account, so it only leaves the server when that page
  // asks for it (`?include=dob`). Every other page gets the student list
  // without it.
  const includeDob = new URL(req.url).searchParams.get("include") === "dob";
  if (!includeDob && user?.kind === "parent") {
    return NextResponse.json({
      user: { ...user, students: user.students.map(({ dateOfBirth: _dob, ...s }) => s) },
    });
  }
  return NextResponse.json({ user });
}

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(180).nullable().optional(),
});

/**
 * Parent self-edit. Only the fields a parent should own — name and email.
 * Phone is the login key; changes go through /api/auth/change-phone/*.
 */
export async function PATCH(req: Request) {
  // Prefer the parent session for the same reason GET does — a co-resident
  // admin cookie (common for staff who also shop) would otherwise resolve
  // first via getCurrentUser() and 401 the parent's own self-edit.
  const parent = await getCurrentParent();
  const me = parent ?? (await getCurrentUser());
  if (me?.kind !== "parent") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await parseJson(req, PatchBody);
  if (body instanceof NextResponse) return body;

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.email !== undefined) update.email = body.email;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }
  await db.update(parents).set(update).where(eq(parents.id, me.id));
  return NextResponse.json({ ok: true });
}
