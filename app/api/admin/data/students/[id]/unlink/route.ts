import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { students, studentGuardianLinks, parents } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { logActivity } from "@/lib/activity";
import { emitStudentEvent } from "@/lib/erp-bridge";
import type { CurrentAdmin } from "@/lib/session";

/**
 * Detach a student from their currently-linked family. Shared body
 * between two routes:
 *   • POST /admin/data/students/[id]/unlink — the per-student "Remove
 *     from family" action on the student detail page.
 *   • DELETE /admin/data/students/[id]/siblings/[siblingId] — the
 *     trash-icon next to each sibling on a focus student's Relations
 *     tab.
 *
 * Effect, atomically:
 *   1. enabled=false + status='blocked' + parent_id=NULL on the target.
 *   2. Deletes student_guardian_links rows whose phone matches the
 *      currently-linked parent's phone — so the next ERP sync's
 *      phone-fallback can't re-attach.
 *   3. activity_log entry naming the admin.
 *
 * Orders / cart / wishlist history is preserved (FKs are nullable).
 */
export async function unlinkStudentFromFamily(
  studentId: string,
  actor: CurrentAdmin
): Promise<
  | { ok: true; studentId: string; previousParentId: string | null; unlinkedPhone: string | null }
  | { ok: false; status: number; error: string }
> {
  const [stu] = await db
    .select({
      id: students.id,
      name: students.name,
      schoolId: students.schoolId,
      parentId: students.parentId,
      enrollmentNumber: students.enrollmentNumber,
    })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!stu) return { ok: false, status: 404, error: "Student not found" };
  if (actor.role === "school_admin" && actor.schoolId !== stu.schoolId) {
    return {
      ok: false,
      status: 403,
      error: "school_admin cannot unlink a student outside their own school",
    };
  }

  let unlinkedPhone: string | null = null;
  if (stu.parentId) {
    const [par] = await db
      .select({ phone: parents.phone })
      .from(parents)
      .where(eq(parents.id, stu.parentId))
      .limit(1);
    unlinkedPhone = par?.phone ?? null;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(students)
      .set({ enabled: false, status: "blocked", parentId: null })
      .where(eq(students.id, studentId));

    if (unlinkedPhone) {
      await tx
        .delete(studentGuardianLinks)
        .where(
          and(
            eq(studentGuardianLinks.studentId, studentId),
            sql`right(regexp_replace(coalesce(${studentGuardianLinks.phoneNo}, ''), '\D', '', 'g'), 10) = ${unlinkedPhone}`
          )
        );
    }
  });

  await logActivity({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "student.unlinked",
    entityType: "student",
    entityId: studentId,
    summary: `Removed ${stu.name ?? stu.enrollmentNumber ?? studentId} from family${
      unlinkedPhone ? ` (phone ${unlinkedPhone})` : ""
    }`,
    diff: { parentId: stu.parentId, unlinkedPhone, enabled: false, status: "blocked" },
  });

  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${studentId}`);
  void emitStudentEvent(studentId);

  return {
    ok: true,
    studentId,
    previousParentId: stu.parentId,
    unlinkedPhone,
  };
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin("super", "ops", "school_admin");
  if (isResponse(guard)) return guard;
  const { id: studentId } = await params;
  const result = await unlinkStudentFromFamily(studentId, guard);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
