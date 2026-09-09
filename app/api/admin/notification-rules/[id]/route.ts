import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { notificationRules } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity, diffFields } from "@/lib/activity";
import { validateTemplate, EVENT_VARS } from "@/lib/notification-template";

const KNOWN_EVENTS = Object.keys(EVENT_VARS) as [string, ...string[]];
const Body = z.object({
  name: z.string().optional(),
  eventType: z.enum(KNOWN_EVENTS).optional(),
  channel: z.enum(["email", "sms", "push"]).optional(),
  recipientType: z.enum(["customer", "admin", "school"]).optional(),
  templateId: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  bodyTemplate: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("settings-otp.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  // If anything affecting templating changed, re-validate against the merged
  // (existing + patch) state so partial updates don't bypass validation.
  if (
    body.eventType !== undefined ||
    body.channel !== undefined ||
    body.subject !== undefined ||
    body.bodyTemplate !== undefined
  ) {
    const [existing] = await db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.id, id))
      .limit(1);
    if (!existing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const merged = {
      eventType: body.eventType ?? existing.eventType,
      channel: (body.channel ?? existing.channel) as "email" | "sms" | "push",
      subject: body.subject !== undefined ? body.subject : existing.subject,
      bodyTemplate:
        body.bodyTemplate !== undefined
          ? body.bodyTemplate
          : existing.bodyTemplate,
    };
    const tplErrors = validateTemplate(merged);
    if (tplErrors.length > 0) {
      return NextResponse.json(
        { error: "Template validation failed", details: tplErrors },
        { status: 400 }
      );
    }
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(body)) if (v !== undefined) update[k] = v;
  const [before] = await db
    .select()
    .from(notificationRules)
    .where(eq(notificationRules.id, id))
    .limit(1);
  await db
    .update(notificationRules)
    .set(update)
    .where(eq(notificationRules.id, id));
  if (before) {
    const after = { ...update };
    delete after.updatedAt;
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      after,
      {
        name: "Name",
        eventType: "Event",
        channel: "Channel",
        recipientType: "Recipient",
        templateId: "Template",
        subject: "Subject",
        bodyTemplate: "Body",
        enabled: "Enabled",
      }
    );
    if (changes.length > 0) {
      void logAdminActivity(guard, {
        action: "notification_rule.update",
        entityType: "notification_rule",
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
  const guard = await requirePermission("settings-otp.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [before] = await db
    .select()
    .from(notificationRules)
    .where(eq(notificationRules.id, id))
    .limit(1);
  await db.delete(notificationRules).where(eq(notificationRules.id, id));
  void logAdminActivity(guard, {
    action: "notification_rule.delete",
    entityType: "notification_rule",
    entityId: id,
    summary: `Deleted notification rule ${before?.name ?? id}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
