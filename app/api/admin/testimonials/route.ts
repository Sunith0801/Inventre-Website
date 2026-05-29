import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { testimonials } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { invalidate } from "@/lib/cache";

const Body = z.object({
  principalName: z.string().min(1),
  role: z.string().min(1),
  shortLabel: z.string().nullable().optional(),
  quote: z.string().min(1),
  photoUrl: z.string().nullable().optional(),
  isFeatured: z.boolean(),
  sortOrder: z.number().int().default(0),
  schoolId: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const [created] = await db
    .insert(testimonials)
    .values({
      principalName: body.principalName,
      role: body.role,
      shortLabel: body.shortLabel || null,
      quote: body.quote,
      photoUrl: body.photoUrl || null,
      isFeatured: body.isFeatured,
      sortOrder: body.sortOrder,
      schoolId: body.schoolId || null,
    })
    .returning();
  await invalidate("home:all");
  revalidatePath("/");
  return NextResponse.json({ testimonial: created });
}
