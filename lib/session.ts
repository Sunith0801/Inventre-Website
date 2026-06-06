import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { erpGradeToReal } from "@/lib/grade-translate";
import { last10 } from "@/lib/phone";
import {
  parents,
  students,
  schools,
  users,
  studentGuardianLinks,
  guardians,
  schoolGradeMappings,
} from "@/db/schema";
import {
  SESSION_COOKIE,
  ADMIN_SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSession,
  verifySession,
  type SessionPayload,
} from "./jwt";

/** Convert an ERP-relative path (e.g. /files/logo.png) to a full URL using ERP_BASE_URL.
 *  Returns the original value if it's already absolute or null/empty. */
function resolveErpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const base = process.env.ERP_BASE_URL;
  if (base && url.startsWith("/")) return base.replace(/\/$/, "") + url;
  return null;
}

export type CurrentParent = {
  kind: "parent";
  id: string;
  /** Family's primary mobile (parents.phone — the first phone to log in
   *  for this family). Stable across guardians of the same family. */
  phone: string;
  /** The phone the user actually signed in with on the current session.
   *  May differ from `phone` when a second guardian's number routes to
   *  the same parents row via the multi-guardian phone graph. `null`
   *  when the JWT predates the `phone` field (e.g. very old session). */
  loggedInPhone: string | null;
  name: string | null;
  email: string | null;
  /** Terms & Conditions acceptance — set when the parent ticked through
   *  the modal. Used by LoginForm to skip the prompt on subsequent logins
   *  when `tcAcceptedVersion` matches the current `TC_VERSION` constant. */
  tcAcceptedAt: Date | null;
  tcAcceptedVersion: string | null;
  students: {
    id: string;
    name: string;
    class: string | null;
    /** Raw `students.grade` — the uniform/catalog grade. Aligns 1:1 with
     *  product_grades, so it's what the shop feed filters on. */
    grade: string | null;
    /** The school's own name for that grade (school_grade_mappings),
     *  e.g. "Grade 5" → "2". Falls back to `grade` when unmapped. */
    schoolGivenGrade: string | null;
    /** Real CBSE grade label (translated from the ERP-internal +3 offset).
     *  E.g. ERP stores "Grade 9", we expose "Grade 6". The original ERP
     *  value is kept on the student record for admin/traceability. */
    section: string | null;
    enrollmentNumber: string | null;
    isNewStudent: boolean;
    /** Canonical "Male"/"Female". Used to scope Magic Box to Boys/Girls variant. */
    gender: string | null;
    /** Free-form `students.date_of_birth` as stored (ERP keeps it as text).
     *  Surfaced for the siblings/profile card; nullable. */
    dateOfBirth: string | null;
    /** Guardian to greet on parent-area pages. Resolved against the
     *  family's PRIMARY mobile (parents.phone — the number that first
     *  logged in and created the row): the student_guardian_links /
     *  guardians row whose phone matches wins. Falls back to lowest
     *  row_idx when no match. `parents.name` is often a placeholder so
     *  we never use it for the greeting. The greeting is family-level —
     *  it does NOT change based on which guardian's number signed in. */
    guardianName: string | null;
    school: {
      id: string;
      name: string;
      slug: string;
      bannerUrl: string | null;
      logoUrl: string | null;
    };
  }[];
};

export type CurrentAdmin = {
  kind: "admin";
  id: string;
  email: string;
  name: string | null;
  role: "super" | "ops" | "school_admin";
  schoolId: string | null;
  /** Permission keys granted via the user's role. Empty Set if the
   *  user has no `role_id` (legacy rows during the RBAC rollout). */
  permissions: ReadonlySet<string>;
  /** Display name of the assigned role row (e.g. "Super Admin"). Falls
   *  back to a capitalised legacy enum value when role_id is null. */
  roleName: string;
};

export type CurrentUser = CurrentParent | CurrentAdmin | null;

/**
 * Read either session cookie and verify. Tries the admin cookie first so
 * an admin session takes precedence in `getCurrentUser` when both cookies
 * happen to exist (e.g. admin tab + parent tab in the same browser).
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const jar = await cookies();
  const adminTok = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (adminTok) {
    const s = await verifySession(adminTok);
    if (s && s.kind === "admin") return s;
  }
  const parentTok = jar.get(SESSION_COOKIE)?.value;
  if (parentTok) {
    const s = await verifySession(parentTok);
    if (s && s.kind === "parent") return s;
  }
  return null;
});

/**
 * Hydrate the full user object from DB based on the session.
 * Wrapped in React.cache so concurrent server components on the same request
 * share one DB round-trip (parents+students+schools join is heavy).
 */
/**
 * Parent-only variant of getCurrentUser. Reads the parent session cookie
 * directly (ignoring any admin cookie), so that a stale admin cookie left
 * in the browser doesn't shadow a freshly-issued parent session on
 * parent-area pages like /shop.
 */
export const getCurrentParent = cache(async (): Promise<CurrentParent | null> => {
  const jar = await cookies();
  const tok = jar.get(SESSION_COOKIE)?.value;
  if (!tok) return null;
  const sess = await verifySession(tok);
  if (!sess || sess.kind !== "parent") return null;

  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.id, sess.sub))
    .limit(1);
  if (!parent) return null;

  // Storefront only ever picks ENABLED + ACTIVE students. The
  // "Remove from family" admin action flips both fields to hide a
  // wrongly-attached student without losing its history. Also defends
  // against legacy / disabled records (e.g. MCB-prefixed entries that
  // sneak in via the phone-fallback backfill) ever surfacing.
  //
  // Picker membership is the transitive closure of the family's phone
  // graph. Seed with the primary phone (parents.phone); expand once via the
  // bridge of "any guardian phone tied to any already-visible student" so a
  // sibling whose only link is a secondary/co-guardian number (e.g. Kid B
  // only carries the mother's number, while Kid A carries father+mother)
  // still shows up. Plus students whose parent_id already points at me
  // (the canonical link maintained by the migration-0023 trigger).
  //
  // One expansion pass is sufficient in practice: every sibling shares at
  // least one phone with at least one already-visible sibling. We bound
  // depth in the recursive CTE as a safety net.
  const myPhone10 = last10(parent.phone);
  const rows = await db.execute(sql`
    WITH RECURSIVE family_phones AS (
      SELECT ${myPhone10}::text AS p, 0 AS depth
      UNION
      SELECT DISTINCT right(regexp_replace(coalesce(gl2.phone_no, ''), '\D', '', 'g'), 10), fp.depth + 1
      FROM family_phones fp
      JOIN student_guardian_links gl1
        ON right(regexp_replace(coalesce(gl1.phone_no, ''), '\D', '', 'g'), 10) = fp.p
      JOIN student_guardian_links gl2 ON gl2.student_id = gl1.student_id
      WHERE fp.depth < 4
    )
    SELECT
      s.id, s.school_id, s.name, s.class, s.grade, s.section,
      s.enrollment_number, s.is_new_student, s.gender, s.date_of_birth,
      s.parent_id, s.enabled, s.status,
      sc.id AS sc_id, sc.name AS sc_name, sc.slug AS sc_slug,
      sc.banner_url AS sc_banner_url, sc.logo_url AS sc_logo_url,
      sc.school_logo_url AS sc_school_logo_url
    FROM students s
    INNER JOIN schools sc ON sc.id = s.school_id
    WHERE s.enabled = true
      AND s.status = 'active'
      AND (
        s.parent_id = ${parent.id}
        OR EXISTS (
          SELECT 1 FROM student_guardian_links gl
           WHERE gl.student_id = s.id
             AND right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10)
                 IN (SELECT p FROM family_phones)
        )
      )
    ORDER BY s.enrollment_number ASC, s.id ASC
  `) as unknown as Array<{
    id: string;
    school_id: string;
    name: string;
    class: string | null;
    grade: string | null;
    section: string | null;
    enrollment_number: string | null;
    is_new_student: boolean;
    gender: string | null;
    date_of_birth: string | null;
    parent_id: string | null;
    enabled: boolean;
    status: string;
    sc_id: string;
    sc_name: string;
    sc_slug: string;
    sc_banner_url: string | null;
    sc_logo_url: string | null;
    sc_school_logo_url: string | null;
  }>;
  // Reshape raw rows back into the original { student, school } pair so the
  // downstream guardian-name / school-given-grade lookups stay unchanged.
  const reshapedRows = rows.map((r) => ({
    student: {
      id: r.id,
      schoolId: r.school_id,
      name: r.name,
      class: r.class,
      grade: r.grade,
      section: r.section,
      enrollmentNumber: r.enrollment_number,
      isNewStudent: r.is_new_student,
      gender: r.gender,
      dateOfBirth: r.date_of_birth,
      parentId: r.parent_id,
      enabled: r.enabled,
      status: r.status,
    } as typeof students.$inferSelect,
    school: {
      id: r.sc_id,
      name: r.sc_name,
      slug: r.sc_slug,
      bannerUrl: r.sc_banner_url,
      logoUrl: r.sc_logo_url,
      schoolLogoUrl: r.sc_school_logo_url,
    } as Pick<typeof schools.$inferSelect, "id" | "name" | "slug" | "bannerUrl" | "logoUrl" | "schoolLogoUrl">,
  }));
  // Deterministic order is enforced inside the raw query above
  // (`ORDER BY s.enrollment_number ASC, s.id ASC`) so `me.students[0]`
  // (the silent fallback target for GET /api/cart and the checkout
  // anchor) stays stable across requests.

  // Resolve the guardian to greet per student. Two-tier:
  //   1. Prefer the guardian whose phone equals the family's PRIMARY
  //      mobile (parents.phone — the first phone to log in for this
  //      family, which is also the phone stored on the parents row).
  //      This keeps the welcome name stable regardless of which
  //      guardian's number is on the current session.
  //   2. Fall back to the lowest row_idx — used when no link matches
  //      the primary number (e.g. an admin-added phone that has no
  //      guardian record linked yet).
  const studentIds = reshapedRows.map((r) => r.student.id);
  const primaryPhone10 = last10(parent.phone);

  const linkRows = studentIds.length
    ? await db
        .select({
          studentId: studentGuardianLinks.studentId,
          linkName: studentGuardianLinks.guardianName,
          rowIdx: studentGuardianLinks.rowIdx,
          phoneNo: studentGuardianLinks.phoneNo,
          guardianErpName: studentGuardianLinks.guardianErpName,
        })
        .from(studentGuardianLinks)
        .where(inArray(studentGuardianLinks.studentId, studentIds))
        .orderBy(asc(studentGuardianLinks.studentId), asc(studentGuardianLinks.rowIdx))
    : [];

  const erpNames = Array.from(
    new Set(
      linkRows
        .map((g) => g.guardianErpName)
        .filter((v): v is string => !!v)
    )
  );
  const masterRows = erpNames.length
    ? await db
        .select({
          erpName: guardians.erpName,
          name: guardians.guardianName,
          mobile: guardians.mobileNumber,
          alt: guardians.alternateNumber,
        })
        .from(guardians)
        .where(inArray(guardians.erpName, erpNames))
    : [];
  const byErp = new Map(
    masterRows
      .filter((m): m is typeof m & { erpName: string } => !!m.erpName)
      .map((m) => [m.erpName, m])
  );

  const phoneMatchByStudent = new Map<string, string>();
  const fallbackByStudent = new Map<string, string>();
  for (const g of linkRows) {
    const master = g.guardianErpName ? byErp.get(g.guardianErpName) : null;
    const resolvedName =
      (g.linkName && g.linkName.trim()) || (master?.name ?? null);
    if (!resolvedName) continue;

    if (!fallbackByStudent.has(g.studentId)) {
      fallbackByStudent.set(g.studentId, resolvedName);
    }

    if (primaryPhone10 && !phoneMatchByStudent.has(g.studentId)) {
      const matches =
        last10(g.phoneNo) === primaryPhone10 ||
        (master ? last10(master.mobile) === primaryPhone10 : false) ||
        (master ? last10(master.alt) === primaryPhone10 : false);
      if (matches) phoneMatchByStudent.set(g.studentId, resolvedName);
    }
  }

  const firstGuardianByStudent = new Map<string, string>();
  for (const sid of studentIds) {
    const name = phoneMatchByStudent.get(sid) ?? fallbackByStudent.get(sid);
    if (name) firstGuardianByStudent.set(sid, name);
  }

  // School-given grade label per (school, Targeted-grade).
  //
  // `students.grade` holds the Targeted value (Nursery / LKG / UKG /
  // Grade 1..12). `school_grade_mappings.grade` still holds the ERP-uniform
  // value (Grade 1..15). Translate the mapping's `grade` through
  // erpGradeToReal so the key is in Targeted space and the lookup
  // matches the student's stored value correctly. Without this
  // translation, a Targeted "Grade 6" student would accidentally match
  // the uniform "Grade 6" row (school-given "Grade 3") and the header
  // would read "Class 3" instead of "Class 6".
  const gradeLabel = new Map<string, string>();
  const mapKeys = reshapedRows
    .map((r) => ({ schoolId: r.student.schoolId, grade: r.student.grade }))
    .filter((k) => k.grade);
  if (mapKeys.length) {
    const schoolIds = [...new Set(mapKeys.map((k) => k.schoolId))];
    const mappings = await db
      .select({
        schoolId: schoolGradeMappings.schoolId,
        grade: schoolGradeMappings.grade,
        label: schoolGradeMappings.schoolGivenGradeName,
      })
      .from(schoolGradeMappings)
      .where(inArray(schoolGradeMappings.schoolId, schoolIds));
    for (const m of mappings) {
      if (!m.grade || !m.label) continue;
      // Raw-to-raw keying. Each school's mapping vocabulary must match
      // the vocabulary of its students.grade — MCB schools use CBSE
      // throughout post-cleanup; ERP-only schools still use ERP. Either
      // way both sides line up at the same string so no translation
      // needed.
      gradeLabel.set(`${m.schoolId}::${m.grade}`, m.label);
    }
  }

  return {
    kind: "parent",
    id: parent.id,
    phone: parent.phone,
    loggedInPhone: sess.phone ?? null,
    name: parent.name,
    email: parent.email,
    tcAcceptedAt: parent.tcAcceptedAt ?? null,
    tcAcceptedVersion: parent.tcAcceptedVersion ?? null,
    students: reshapedRows.map((r) => ({
      id: r.student.id,
      name: r.student.name,
      class: erpGradeToReal(r.student.class) ?? r.student.class,
      grade: r.student.grade,
      schoolGivenGrade:
        (r.student.grade
          ? gradeLabel.get(`${r.student.schoolId}::${r.student.grade}`)
          : null) ?? r.student.grade,
      section: r.student.section,
      enrollmentNumber: r.student.enrollmentNumber,
      isNewStudent: r.student.isNewStudent,
      gender: r.student.gender,
      dateOfBirth: r.student.dateOfBirth ?? null,
      guardianName: firstGuardianByStudent.get(r.student.id) ?? null,
      school: {
        id: r.school.id,
        name: r.school.name,
        slug: r.school.slug,
        bannerUrl: r.school.bannerUrl,
        logoUrl: r.school.logoUrl,
        schoolLogoUrl: resolveErpUrl(r.school.schoolLogoUrl),
      },
    })),
  };
});

export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const sess = await getSession();
  if (!sess) return null;

  if (sess.kind === "parent") {
    // Delegate to the parent-only resolver so the guardian-name lookup and
    // student hydration stay in one place. Both are React.cache wrapped, so
    // co-tenant calls on the same request still share a single round-trip.
    return getCurrentParent();
  }

  // admin
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, sess.sub))
    .limit(1);
  if (!user) return null;

  // Effective permission set = (role perms ∪ user grants) \ user revokes.
  // The legacy `users.role` enum still drives ~310 `requireAdmin(...)`
  // calls (phases 2-3 migrate those); new code uses `me.permissions`
  // via `requirePermission` / `hasPermission` / `canSeePage`.
  const permSet = new Set<string>();
  let roleName = user.role === "super" ? "Super Admin"
              : user.role === "ops" ? "Operations"
              : "School Admin";
  if (user.roleId) {
    const rows = (await db.execute(sql`
      SELECT r.name AS role_name, p.permission
        FROM admin_roles r
        LEFT JOIN admin_role_permissions p ON p.role_id = r.id
       WHERE r.id = ${user.roleId}
    `)) as unknown as { role_name: string; permission: string | null }[];
    for (const r of rows) {
      if (r.permission) permSet.add(r.permission);
      if (r.role_name) roleName = r.role_name;
    }
  }
  // User-level overrides — added by super-admin on /admin/settings/users/[id].
  // `granted=true` adds, `granted=false` revokes (even if the role grants it).
  const overrideRows = (await db.execute(sql`
    SELECT permission, granted
      FROM admin_user_permissions
     WHERE user_id = ${user.id}
  `)) as unknown as { permission: string; granted: boolean }[];
  for (const o of overrideRows) {
    if (o.granted) permSet.add(o.permission);
    else permSet.delete(o.permission);
  }

  return {
    kind: "admin",
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    schoolId: user.schoolId,
    permissions: permSet,
    roleName,
  };
});

/**
 * Whether the session cookie should carry the Secure attribute.
 * Default: true in production (cookie only sent over HTTPS).
 * Escape hatch: set COOKIE_INSECURE=1 AND
 *   ALLOW_INSECURE_COOKIES_IN_PROD=1 to permit plain-HTTP in production
 * (e.g. IP-based deploy without a TLS cert). The double-flag prevents a
 * single leaked env var from silently disabling Secure cookies in prod.
 */
function computeCookieSecure(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const insecureRequested = process.env.COOKIE_INSECURE === "1";
  const allowInProd = process.env.ALLOW_INSECURE_COOKIES_IN_PROD === "1";
  if (insecureRequested && allowInProd) return false;
  return true;
}
const cookieSecure = computeCookieSecure();

/** Issue a fresh session cookie.
 *
 *  `phone` is the number the user actually verified during this login. Two
 *  guardian phones can resolve to the same parents row (see otp/verify's
 *  fallback lookup); persisting which phone signed in lets the UI greet
 *  the right guardian by name instead of always showing the lowest-row_idx
 *  guardian. Optional for back-compat with older callers; getCurrentParent
 *  falls back to lowest row_idx when omitted.
 */
export async function createParentSession(parentId: string, phone?: string) {
  const token = await signSession({
    sub: parentId,
    kind: "parent",
    ...(phone ? { phone } : {}),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function createAdminSession(
  userId: string,
  role: "super" | "ops" | "school_admin",
  schoolId?: string | null
) {
  const token = await signSession({
    sub: userId,
    kind: "admin",
    role,
    schoolId: schoolId ?? undefined,
  });
  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Clear the parent session cookie only. */
export async function destroyParentSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Clear the admin session cookie only. */
export async function destroyAdminSession() {
  const jar = await cookies();
  jar.delete(ADMIN_SESSION_COOKIE);
}

/**
 * Back-compat alias. Existing callers (e.g. parent /api/auth/logout) called
 * `destroySession` expecting the parent cookie to clear. Keep that
 * behaviour and forward to the new specific helper.
 */
export async function destroySession() {
  await destroyParentSession();
}
