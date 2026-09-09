import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { systemSettings } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";
import { parseBody } from "@/lib/parse-body";
import {
  PAYMENT_CHARGES_KEY,
  getPaymentCharges,
} from "@/lib/payment-charges";

export const dynamic = "force-dynamic";

const Body = z.object({
  title: z.string().trim().min(1).max(200),
  intro: z.string().trim().min(1).max(500),
  rows: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        rate: z.string().trim().min(1).max(40),
      }),
    )
    .min(1)
    .max(20),
  footnote: z.string().trim().min(1).max(600),
});

export async function GET() {
  const guard = await requirePermission("payment-charges.read");
  if (isResponse(guard)) return guard;
  const config = await getPaymentCharges();
  return NextResponse.json(config);
}

export async function PUT(req: Request) {
  const guard = await requirePermission("payment-charges.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;

  await db
    .insert(systemSettings)
    .values({ key: PAYMENT_CHARGES_KEY, value: parsed })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: parsed, updatedAt: new Date() },
    });

  void logAdminActivity(guard, {
    action: "settings.update",
    entityType: "settings",
    entityId: "payment-charges",
    summary: "Updated payment charges",
    req,
  });
  return NextResponse.json({ ok: true });
}
