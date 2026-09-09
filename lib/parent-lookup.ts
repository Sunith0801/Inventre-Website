import "server-only";
import { and, asc, eq, or, sql } from "drizzle-orm";
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
 *
 * Resolution is two-tier and deterministic:
 *   1. A guardian LINK whose own `phone_no` matches — this is the
 *      authoritative per-student contact and ALWAYS wins.
 *   2. Only if no link phone matches, fall back to the guardian MASTER
 *      record's mobile / alternate (covers numbers that live solely on
 *      the ERP master and were never copied onto a link).
 *
 * Tier 1 must beat tier 2 because a single ERP guardian master can be
 * shared across siblings on DIFFERENT accounts, each carrying its own
 * per-link phone override. Matching the shared master's mobile would then
 * pull a phone into the wrong sibling's family (e.g. two "Aarti Kumari"
 * kids on 9543917656 / 9543917657 sharing master 00185, whose mobile is
 * 9543917656 — a login on 656 must land on the child whose LINK is 656,
 * not the sibling who merely inherits the master). `ORDER BY created_at`
 * keeps the choice stable when a tier is genuinely ambiguous.
 */
export async function resolveFamilyParent(
  phone: string
): Promise<FamilyParent | null> {
  // Query uses the Drizzle query builder (returns camelCase) — raw
  // db.execute(sql`SELECT p.* …`) goes through postgres-js and returns
  // snake_case, which silently breaks `primary.passwordHash` access.

  // Tier 1: authoritative per-link phone.
  const linkRows = await db
    .select({ parent: parents })
    .from(parents)
    .innerJoin(students, eq(students.parentId, parents.id))
    .innerJoin(
      studentGuardianLinks,
      eq(studentGuardianLinks.studentId, students.id)
    )
    .where(
      and(
        eq(parents.status, "active"),
        sql`${last10Sql(studentGuardianLinks.phoneNo)} = ${phone}`
      )
    )
    .orderBy(asc(parents.createdAt), asc(parents.id))
    .limit(1);
  if (linkRows[0]) return linkRows[0].parent;

  // Tier 2: fall back to the ERP guardian master's mobile / alternate.
  const masterRows = await db
    .select({ parent: parents })
    .from(parents)
    .innerJoin(students, eq(students.parentId, parents.id))
    .innerJoin(
      studentGuardianLinks,
      eq(studentGuardianLinks.studentId, students.id)
    )
    .innerJoin(
      guardians,
      eq(guardians.erpName, studentGuardianLinks.guardianErpName)
    )
    .where(
      and(
        eq(parents.status, "active"),
        or(
          sql`${last10Sql(guardians.mobileNumber)} = ${phone}`,
          sql`${last10Sql(guardians.alternateNumber)} = ${phone}`
        )
      )
    )
    .orderBy(asc(parents.createdAt), asc(parents.id))
    .limit(1);
  return masterRows[0]?.parent ?? null;
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
