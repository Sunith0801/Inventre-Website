import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requirePermission, isResponse } from "@/server/admin-guard";
import { ADMIN_PERMISSION_KEYS } from "@/lib/admin-permissions";
import { logActivity } from "@/server/activity";
import { parseBody } from "@/server/parse-body";

/**
 * Replace the full set of per-user permission overrides for a target user.
 *
 * Body shape:
 *   { grants: string[], revokes: string[] }
 *
 * After this call, admin_user_permissions for the user holds exactly:
 *   - (permission, granted=true)  for every `grants` entry, and
 *   - (permission, granted=false) for every `revokes` entry.
 *
 * Effective permission set at runtime (computed in lib/session.ts):
 *   (role perms ∪ grants) \ revokes
 *
 * Only super-admins should reach this endpoint — gated by `roles.write`,
 * which only super-admin has by default in the 0046 migration.
 */
const Body = z.object({
  grants: z.array(z.string().min(1)),
  revokes: z.array(z.string().min(1)),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePermission("roles.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const { grants, revokes } = parsed;

  // Reject junk permission keys early.
  for (const p of [...grants, ...revokes]) {
    if (!ADMIN_PERMISSION_KEYS.has(p)) {
      return NextResponse.json({ error: `Unknown permission key: ${p}` }, { status: 400 });
    }
  }
  // grants and revokes must be disjoint — same key can't be both granted
  // and revoked (it would be meaningless).
  const overlap = grants.filter((g) => revokes.includes(g));
  if (overlap.length) {
    return NextResponse.json(
      { error: `Permission cannot be both granted and revoked: ${overlap.join(", ")}` },
      { status: 400 },
    );
  }

  // Self-edit guard. A super-admin who revokes their own perms could
  // lock themselves out of the very page they used to get here.
  if (guard.id === id) {
    return NextResponse.json(
      { error: "You can't edit your own permission overrides — ask another super-admin." },
      { status: 400 },
    );
  }

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM admin_user_permissions WHERE user_id = ${id}`);
    const rows = [
      ...grants.map((p) => ({ p, g: true })),
      ...revokes.map((p) => ({ p, g: false })),
    ];
    if (rows.length > 0) {
      await tx.execute(sql`
        INSERT INTO admin_user_permissions (user_id, permission, granted, granted_by) VALUES ${sql.join(
          rows.map((r) => sql`(${id}, ${r.p}, ${r.g}, ${guard.id})`),
          sql`, `,
        )}
      `);
    }
  });

  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "admin.user.permissions",
    entityType: "user",
    entityId: id,
    summary: `Updated permission overrides for "${target.email}" (${grants.length} grant${grants.length === 1 ? "" : "s"} / ${revokes.length} revoke${revokes.length === 1 ? "" : "s"})`,
    diff: { grants, revokes },
  });

  return NextResponse.json({ ok: true });
}
