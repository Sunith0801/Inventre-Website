import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reviews } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

const Body = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  await db.update(reviews).set({ status: body.status }).where(eq(reviews.id, id));
  return NextResponse.json({ ok: true });
}
