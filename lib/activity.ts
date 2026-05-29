import "server-only";
import { db } from "@/db/client";
import { activityLog } from "@/db/schema";

export async function logActivity(input: {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string | null;
  diff?: Record<string, unknown> | null;
}) {
  try {
    await db.insert(activityLog).values({
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary ?? null,
      diff: input.diff ?? null,
    });
  } catch (e) {
    // Never let logging break the action it's tracking.
    console.warn("activity log write failed:", e);
  }
}
