import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { systemSettings } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";
import {
  SMS_REAL_SEND_KEY,
  EMAIL_REAL_SEND_KEY,
  getOtpToggles,
} from "@/lib/otp-toggles";

export const dynamic = "force-dynamic";

const Body = z.object({
  smsRealSend: z.boolean(),
  emailRealSend: z.boolean(),
});

export async function GET() {
  const guard = await requirePermission("settings-otp.read");
  if (isResponse(guard)) return guard;
  const toggles = await getOtpToggles();
  return NextResponse.json(toggles);
}

export async function PUT(req: Request) {
  const guard = await requirePermission("settings-otp.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  await db
    .insert(systemSettings)
    .values({ key: SMS_REAL_SEND_KEY, value: body.smsRealSend })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: body.smsRealSend, updatedAt: new Date() },
    });
  await db
    .insert(systemSettings)
    .values({ key: EMAIL_REAL_SEND_KEY, value: body.emailRealSend })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: body.emailRealSend, updatedAt: new Date() },
    });

  void logAdminActivity(guard, {
    action: "settings.update",
    entityType: "settings",
    entityId: "otp",
    summary: "Updated OTP settings",
    req,
  });
  return NextResponse.json({ ok: true });
}
