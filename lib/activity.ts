import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog } from "@/db/schema";
import type { CurrentAdmin } from "@/lib/session";

/** One structured field change, rendered as an Old → New row. */
export type FieldChange = {
  field: string;
  /** Human label for the field (defaults to `field`). */
  label?: string;
  old: unknown;
  new: unknown;
};

export type LogActivityInput = {
  actorId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  /** Dotted verb, e.g. "order.update" | "order.cancel" | "exchange.approve". */
  action: string;
  /** Lowercase record type, e.g. "order" | "exchange" | "student". */
  entityType: string;
  entityId?: string | null;
  summary?: string | null;
  changes?: FieldChange[] | null;
  /** Free-form snapshot payload (legacy / non-field-level context). */
  diff?: Record<string, unknown> | null;
  remarks?: string | null;
  ip?: string | null;
};

export async function logActivity(input: LogActivityInput) {
  try {
    await db.insert(activityLog).values({
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      actorName: input.actorName ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary ?? null,
      changes: (input.changes ?? null) as unknown as Record<string, unknown> | null,
      diff: input.diff ?? null,
      remarks: input.remarks ?? null,
      ip: input.ip ?? null,
    });
  } catch (e) {
    // Never let logging break the action it's tracking.
    console.warn("activity log write failed:", e);
  }
}

/**
 * Batch variant of {@link logActivity} — writes many rows in a single insert.
 * Use for bulk operations (e.g. bulk-minting coupons) so we don't fire N
 * separate inserts. Best-effort; never throws.
 */
export async function logActivityBatch(inputs: LogActivityInput[]) {
  if (inputs.length === 0) return;
  try {
    await db.insert(activityLog).values(
      inputs.map((input) => ({
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        actorName: input.actorName ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        changes: (input.changes ?? null) as unknown as Record<string, unknown> | null,
        diff: input.diff ?? null,
        remarks: input.remarks ?? null,
        ip: input.ip ?? null,
      })),
    );
  } catch (e) {
    console.warn("activity log batch write failed:", e);
  }
}

/**
 * Log an admin action, auto-filling the actor (id/email/name/role) from the
 * resolved `CurrentAdmin` and the IP from the request. This is the call every
 * admin mutation should use.
 */
export async function logAdminActivity(
  me: Pick<CurrentAdmin, "id" | "email" | "name" | "role">,
  input: Omit<LogActivityInput, "actorId" | "actorEmail" | "actorName" | "actorRole" | "ip"> & {
    req?: Request;
    ip?: string | null;
  }
) {
  const { req, ip, ...rest } = input;
  await logActivity({
    ...rest,
    actorId: me.id,
    actorEmail: me.email,
    actorName: me.name ?? null,
    actorRole: me.role,
    ip: ip ?? (req ? clientIp(req) : null),
  });
}

/** Best-effort client IP from proxy headers (nginx → x-forwarded-for). */
export function clientIp(req: Request): string | null {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? null;
}

/**
 * Build a structured change list by comparing a before object to a set of new
 * values. Only fields whose value actually changed are emitted. Pass `labels`
 * to give a field a human name (e.g. { status: "Delivery Status" }).
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string> = {}
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const key of Object.keys(after)) {
    const oldVal = before[key];
    const newVal = after[key];
    if (normalize(oldVal) === normalize(newVal)) continue;
    out.push({ field: key, label: labels[key] ?? key, old: oldVal, new: newVal });
  }
  return out;
}

function normalize(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export type RecordActivityRow = {
  id: number;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  summary: string | null;
  changes: FieldChange[] | null;
  remarks: string | null;
  ip: string | null;
  createdAt: Date;
};

/** All activity for a single record, newest first — drives the History tab. */
export async function listRecordActivity(
  entityType: string,
  entityId: string,
  limit = 200
): Promise<RecordActivityRow[]> {
  const rows = await db
    .select({
      id: activityLog.id,
      actorEmail: activityLog.actorEmail,
      actorName: activityLog.actorName,
      actorRole: activityLog.actorRole,
      action: activityLog.action,
      summary: activityLog.summary,
      changes: activityLog.changes,
      remarks: activityLog.remarks,
      ip: activityLog.ip,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .where(and(eq(activityLog.entityType, entityType), eq(activityLog.entityId, entityId)))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    changes: (r.changes as FieldChange[] | null) ?? null,
  }));
}
