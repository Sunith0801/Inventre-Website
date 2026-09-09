import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { webhookEndpoints } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity, diffFields } from "@/lib/activity";

const Body = z.object({
  name: z.string().optional(),
  url: z.string().url().optional(),
  events: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("settings-erp-bridge.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) update[k] = v;
  const [before] = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, id))
    .limit(1);
  await db.update(webhookEndpoints).set(update).where(eq(webhookEndpoints.id, id));
  if (before) {
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      update,
      { name: "Name", url: "URL", events: "Events", enabled: "Enabled" }
    );
    if (changes.length > 0) {
      void logAdminActivity(guard, {
        action: "webhook.update",
        entityType: "webhook",
        entityId: id,
        summary: `Updated ${changes.map((c) => c.label ?? c.field).join(", ")}`,
        changes,
        req,
      });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("settings-erp-bridge.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [before] = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, id))
    .limit(1);
  await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
  void logAdminActivity(guard, {
    action: "webhook.delete",
    entityType: "webhook",
    entityId: id,
    summary: `Deleted webhook ${before?.name ?? id}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
