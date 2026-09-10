import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentBlocks } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { invalidate } from "@/server/cache";
import { logAdminActivity } from "@/server/activity";

const Body = z.object({
  data: z.unknown(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const guard = await requirePermission("content.write");
  if (isResponse(guard)) return guard;
  const { key } = await params;
  const decoded = decodeURIComponent(key);
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const [existing] = await db
    .select()
    .from(contentBlocks)
    .where(eq(contentBlocks.key, decoded))
    .limit(1);
  if (existing) {
    await db
      .update(contentBlocks)
      .set({
        data: body.data,
        updatedBy: guard.id,
        updatedAt: new Date(),
      })
      .where(eq(contentBlocks.key, decoded));
  } else {
    await db.insert(contentBlocks).values({
      key: decoded,
      data: body.data,
      updatedBy: guard.id,
    });
  }
  // Bust every cache layer that may serve a stale value:
  //   • content:{key}  — for content_blocks readers
  //   • media:{key}    — for getMediaUrl() (hero video, posters, etc.)
  //   • home:all       — for the home-page aggregate
  // Plus revalidatePath so Next's SSR cache for "/" is dropped.
  await invalidate(`content:${decoded}`, `media:${decoded}`, "home:all");
  revalidatePath("/");
  void logAdminActivity(guard, {
    action: "content.update",
    entityType: "content",
    entityId: decoded,
    summary: `Updated content block ${decoded}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
