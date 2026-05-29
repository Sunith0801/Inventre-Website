import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import crypto from "crypto";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { webhookEndpoints } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

export async function GET() {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .orderBy(desc(webhookEndpoints.createdAt));
  return NextResponse.json({ endpoints: rows });
}

const Body = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  enabled: z.boolean().default(true),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  // Generate a signing secret on creation. Visible only this once.
  const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
  const [created] = await db
    .insert(webhookEndpoints)
    .values({
      name: body.name,
      url: body.url,
      secret,
      events: body.events,
      enabled: body.enabled,
    })
    .returning();
  return NextResponse.json({ endpoint: created, secret });
}
