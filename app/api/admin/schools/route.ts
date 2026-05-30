import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { schools } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";

const Body = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  status: z.enum(["active", "onboarding", "paused"]),
  isFeatured: z.boolean(),
  contactEmail: z.string().email().or(z.literal("")).nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  bannerUrl: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;

  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const [created] = await db
    .insert(schools)
    .values({
      name: body.name,
      slug: body.slug,
      city: body.city || null,
      state: body.state || null,
      status: body.status,
      isFeatured: body.isFeatured,
      contactEmail: body.contactEmail || null,
      contactPhone: body.contactPhone || null,
      bannerUrl: body.bannerUrl || null,
      logoUrl: body.logoUrl || null,
    })
    .returning();
  return NextResponse.json({ school: created });
}
