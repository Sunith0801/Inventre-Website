import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, students, studentGuardianLinks, guardians } from "@/db/schema";
import { last10Sql } from "@/lib/phone";

export type FamilyParent = typeof parents.$inferSelect;

/**
 * Resolve the family's primary `parents` row for a given guardian phone.
 *
 * Authorisation rule: a phone may only sign in when it is present on at
 * least one `student_guardian_links` row (or the linked `guardians`
 * master record's mobile / alternate) for a student that's been claimed
 * (`students.parent_id IS NOT NULL`). The link row is the single source
 * of truth for "this phone is allowed to act on this family". Deleting
 * the link in admin therefore revokes login on the next attempt.
 *
 * Notable consequence: a `parents` row whose `phone` column matches the
 * caller but who has NO matching guardian-link row will NOT be returned
 * — login on that parents row is dead until an admin (re-)adds the
 * guardian. This was an explicit policy decision; the previous
 * exact-phone fallback let admin-added accounts log in without any
 * guardian-link row, which was surprising when admins deleted the
 * (only visible) relation and expected login to break.
 *
 * Returns null when no guardian-link record authorises this phone.
 */
export async function resolveFamilyParent(
  phone: string
): Promise<FamilyParent | null> {
  // Query uses the Drizzle query builder (returns camelCase) — raw
  // db.execute(sql`SELECT p.* …`) goes through postgres-js and returns
  // snake_case, which silently breaks `primary.passwordHash` access.
  const graphRows = await db
    .select({ parent: parents })
    .from(parents)
    .innerJoin(students, eq(students.parentId, parents.id))
    .innerJoin(
      studentGuardianLinks,
      eq(studentGuardianLinks.studentId, students.id)
    )
    .leftJoin(guardians, eq(guardians.erpName, studentGuardianLinks.guardianErpName))
    .where(
      and(
        eq(parents.status, "active"),
        or(
          sql`${last10Sql(studentGuardianLinks.phoneNo)} = ${phone}`,
          sql`${last10Sql(guardians.mobileNumber)} = ${phone}`,
          sql`${last10Sql(guardians.alternateNumber)} = ${phone}`
        )
      )
    )
    .limit(1);
  return graphRows[0]?.parent ?? null;
}

/**
 * True when the family this parent owns has at least one verified
 * student — i.e. someone has completed first-time setup for this
 * household. Used by phone-status to decide between the password screen
 * (verified) and the first-time-modal screen (unverified).
 */
export async function familyHasVerifiedStudent(
  parentId: string
): Promise<boolean> {
  const r = (await db.execute(sql`
    SELECT 1 FROM students
     WHERE parent_id = ${parentId}
       AND is_verified = true
     LIMIT 1
  `)) as unknown as unknown[];
  return r.length > 0;
}
