import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { faqs } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { invalidate } from "@/lib/cache";

const Body = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  category: z.string().default("general"),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const [created] = await db.insert(faqs).values(body).returning();
  await invalidate("home:all");
  revalidatePath("/");
  return NextResponse.json({ faq: created });
}
