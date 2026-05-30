import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { notificationRules } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
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
  await db
    .update(notificationRules)
    .set(update)
    .where(eq(notificationRules.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("settings-otp.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  await db.delete(notificationRules).where(eq(notificationRules.id, id));
  return NextResponse.json({ ok: true });
}
