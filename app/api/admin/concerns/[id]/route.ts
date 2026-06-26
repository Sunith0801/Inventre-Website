import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { concerns, concernMessages } from "@/db/schema";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
import { logActivity } from "@/lib/activity";

/**
 * Admin actions on a Parent Concern: update status / assign (PATCH) and
 * reply to the parent (POST a message). Both append to the concern's message
 * thread so the history is complete.
 */

export const dynamic = "force-dynamic";

const VALID_STATUS = [
  "submitted",
  "in_progress",
  "waiting_customer",
  "waiting_school",
  "resolved",
] as const;

const Patch = z.object({
  status: z.enum(VALID_STATUS).optional(),
  assignedToName: z.string().trim().max(120).nullable().optional(),
});

async function actorName(guard: { email?: string | null; name?: string | null }): Promise<string> {
  return guard.name || guard.email || "Support";
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyPermission("contact-forms.write", "returns.write", "orders.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  let body: z.infer<typeof Patch>;
  try {
    body = Patch.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const [existing] = await db.select().from(concerns).where(eq(concerns.id, id)).limit(1);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const notes: string[] = [];
  if (body.status && body.status !== existing.status) {
    patch.status = body.status;
    notes.push(`Status → ${body.status.replace(/_/g, " ")}`);
  }
  if (body.assignedToName !== undefined && body.assignedToName !== existing.assignedToName) {
    patch.assignedToName = body.assignedToName;
    notes.push(body.assignedToName ? `Assigned to ${body.assignedToName}` : "Unassigned");
  }

  await db.update(concerns).set(patch).where(eq(concerns.id, id));
  const who = await actorName(guard);
  for (const n of notes) {
    await db.insert(concernMessages).values({ concernId: id, author: "system", authorName: who, body: n });
  }
  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "concern.update",
    entityType: "concern",
    entityId: id,
    summary: `Concern ${existing.concernNumber ?? id.slice(0, 8)}: ${notes.join("; ") || "updated"}`,
  });

  return NextResponse.json({ ok: true });
}

const Reply = z.object({ body: z.string().trim().min(1).max(4000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyPermission("contact-forms.write", "returns.write", "orders.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  let body: z.infer<typeof Reply>;
  try {
    body = Reply.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Reply cannot be empty" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: concerns.id })
    .from(concerns)
    .where(eq(concerns.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const who = await actorName(guard);
  await db.insert(concernMessages).values({
    concernId: id,
    author: "agent",
    authorName: who,
    body: body.body,
  });
  await db.update(concerns).set({ updatedAt: new Date() }).where(eq(concerns.id, id));

  return NextResponse.json({ ok: true });
}
