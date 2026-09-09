import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { faqs } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { invalidate } from "@/lib/cache";
import { logAdminActivity, diffFields } from "@/lib/activity";

const Body = z.object({
  question: z.string().optional(),
  answer: z.string().optional(),
  category: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

async function bust() {
  await invalidate("home:all");
  revalidatePath("/");
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("content.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const update: Record<string, unknown> = {};
  for (const k of Object.keys(body) as (keyof typeof body)[]) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  const [before] = await db.select().from(faqs).where(eq(faqs.id, id)).limit(1);
  await db.update(faqs).set(update).where(eq(faqs.id, id));
  await bust();
  if (before) {
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      update,
      {
        question: "Question",
        answer: "Answer",
        category: "Category",
        sortOrder: "Sort Order",
        isActive: "Active",
      }
    );
    if (changes.length > 0) {
      void logAdminActivity(guard, {
        action: "faq.update",
        entityType: "faq",
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
  const guard = await requirePermission("content.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [before] = await db.select().from(faqs).where(eq(faqs.id, id)).limit(1);
  await db.delete(faqs).where(eq(faqs.id, id));
  await bust();
  void logAdminActivity(guard, {
    action: "faq.delete",
    entityType: "faq",
    entityId: id,
    summary: `Deleted FAQ ${before?.question ?? id}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
