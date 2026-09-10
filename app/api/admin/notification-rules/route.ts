import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { notificationRules } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import { validateTemplate, EVENT_VARS } from "@/server/notify/notification-template";
import { desc } from "drizzle-orm";

export async function GET() {
  const guard = await requirePermission("settings-otp.read");
  if (isResponse(guard)) return guard;
  const rows = await db
    .select()
    .from(notificationRules)
    .orderBy(desc(notificationRules.createdAt));
  return NextResponse.json({ rules: rows });
}

const KNOWN_EVENTS = Object.keys(EVENT_VARS) as [string, ...string[]];
const Body = z.object({
  name: z.string().min(1),
  eventType: z.enum(KNOWN_EVENTS),
  channel: z.enum(["email", "sms", "push"]),
  recipientType: z.enum(["customer", "admin", "school"]),
  templateId: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  bodyTemplate: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
});

export async function POST(req: Request) {
  const guard = await requirePermission("settings-otp.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const tplErrors = validateTemplate({
    eventType: body.eventType,
    channel: body.channel,
    subject: body.subject,
    bodyTemplate: body.bodyTemplate,
  });
  if (tplErrors.length > 0) {
    return NextResponse.json(
      { error: "Template validation failed", details: tplErrors },
      { status: 400 }
    );
  }
  const [created] = await db
    .insert(notificationRules)
    .values({
      name: body.name,
      eventType: body.eventType,
      channel: body.channel,
      recipientType: body.recipientType,
      templateId: body.templateId ?? null,
      subject: body.subject ?? null,
      bodyTemplate: body.bodyTemplate ?? null,
      enabled: body.enabled,
    })
    .returning();
  void logAdminActivity(guard, {
    action: "notification_rule.create",
    entityType: "notification_rule",
    entityId: created.id,
    summary: `Created notification rule ${created.name}`,
    req,
  });
  return NextResponse.json({ rule: created });
}
