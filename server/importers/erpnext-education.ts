/**
 * Importer for the legacy ERPNext "Education" surface — pulls Schools,
 * Grades, Guardians and Students into our `erp_*` mirror tables.
 *
 * Idempotent: every row is upserted by `erp_name`. Re-runs only update
 * changed rows; nothing in the storefront `schools`/`parents`/`students`
 * tables is touched.
 */
import "server-only";
import { db, schema } from "@/db/client";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  erpCount,
  iterateErpDocs,
  type ErpNextConfig,
} from "@/server/erp/erpnext-client";
import { makeTargetedGradeResolver } from "@/server/repos/grades";
import { upsertGuardianLink, pruneGuardianLinksNotIn } from "@/server/repos/guardians";
import { last10 } from "@/lib/phone";

// Defence in depth for the backfill. If BACKFILL_CUTOVER_ISO is set (we run
// from a script with the env var loaded), the importer refuses to mutate any
// row whose createdAt is at or past the cutover instant — those belong to
// the live website. When the env var is unset (normal in-process sync from
// the Next.js server), CUTOVER_DATE is null and the guard is a no-op.
const CUTOVER_DATE: Date | null = (() => {
  const iso = process.env.BACKFILL_CUTOVER_ISO;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
})();
function isPostCutover(createdAt: Date | string | null | undefined): boolean {
  if (!CUTOVER_DATE || !createdAt) return false;
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  return d.getTime() >= CUTOVER_DATE.getTime();
}

export type EducationSyncReport = {
  schoolsScanned: number;
  schoolsInserted: number;
  schoolsUpdated: number;
  gradesScanned: number;
  gradesInserted: number;
  gradesUpdated: number;
  guardiansScanned: number;
  guardiansInserted: number;
  guardiansUpdated: number;
  studentsScanned: number;
  studentsInserted: number;
  studentsUpdated: number;
  failed: number;
  errors: { entity: string; erpName: string; message: string }[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type EducationSyncOptions = {
  /** Limit students to N for fast testing. */
  maxStudents?: number;
  /** Limit guardians similarly. */
  maxGuardians?: number;
  /** Skip the big two (students + guardians) — useful for a quick schools+grades refresh. */
  skipLarge?: boolean;
};

function asBool(v: unknown): boolean {
  return v === 1 || v === true || v === "1" || v === "true";
}

function asText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function asTimestamp(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v.replace(" ", "T") + (v.includes("Z") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Schools ─────────────────────────────────────────────────────

type ErpSchool = {
  name: string;
  school_code?: string;
  school_name?: string;
  branch_name?: string;
  website_url?: string;
  status?: string;
  school_logo?: string;
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: number | string;
  uniform_details_checkbox?: number;
  books_details_checkbox?: number;
  modified?: string;
  grades_details?: Array<{
    grade?: string;
    school_given_grade_name?: string;
    sections?: string;
    [k: string]: unknown;
  }>;
  school_coordinator?: Array<{
    poc_name?: string;
    email?: string;
    contact_number?: string;
    alternate_number?: string;
    role?: string;
    [k: string]: unknown;
  }>;
  uniform_details?: Array<{
    grade?: string;
    organisation_given_grade?: string;
    sections?: string;
    organisation_given_section?: string;
    house_name?: string;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
};

async function syncSchools(
  report: EducationSyncReport,
  cfg: ErpNextConfig
): Promise<void> {
  for await (const it of iterateErpDocs<ErpSchool>("School", { pageSize: 100, fetchConcurrency: 6 }, cfg)) {
    if (!it.name) continue;
    report.schoolsScanned++;
    try {
      const existing = await db
        .select({ id: schema.schools.id, createdAt: schema.schools.createdAt })
        .from(schema.schools)
        .where(eq(schema.schools.erpName, it.name))
        .limit(1);
      if (existing[0] && isPostCutover(existing[0].createdAt)) continue;

      // After the full merge, `schools` is the canonical table — write
      // both `name` (storefront-side, NOT NULL) and `schoolName`, and
      // map the ERP "Active"/"Inactive" text to the storefront enum.
      const schoolName = asText(it.school_name) ?? it.name;
      const slugBase = `${asText(it.school_code) ?? ""}-${schoolName}`;
      const slug = slugBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      const status = asText(it.status) === "Inactive" ? "paused" as const : "active" as const;

      const values = {
        erpName: it.name,
        schoolCode: asText(it.school_code),
        schoolName,
        name: schoolName,
        slug,
        branchName: asText(it.branch_name),
        websiteUrl: asText(it.website_url),
        status,
        schoolLogoUrl: asText(it.school_logo),
        street: asText(it.street),
        city: asText(it.city),
        state: asText(it.state),
        country: asText(it.country),
        pincode: it.pincode != null ? String(it.pincode) : null,
        uniformDetailsCheckbox: asBool(it.uniform_details_checkbox),
        booksDetailsCheckbox: asBool(it.books_details_checkbox),
        erpRaw: it as unknown as Record<string, unknown>,
        erpModified: asTimestamp(it.modified),
        syncedAt: new Date(),
      };

      let schoolId: string;
      if (existing[0]) {
        schoolId = existing[0].id;
        await db.update(schema.schools).set(values).where(eq(schema.schools.id, schoolId));
        report.schoolsUpdated++;
      } else {
        const [row] = await db.insert(schema.schools).values(values).returning({ id: schema.schools.id });
        schoolId = row.id;
        report.schoolsInserted++;
      }

      // Replace child tables.
      await db.delete(schema.schoolGradeMappings).where(eq(schema.schoolGradeMappings.schoolId, schoolId));
      const gradeRows = (it.grades_details ?? []).map((r, i) => ({
        schoolId,
        rowIdx: i + 1,
        grade: asText(r.grade),
        schoolGivenGradeName: asText(r.school_given_grade_name),
        sections: asText(r.sections),
        raw: r as unknown as Record<string, unknown>,
      }));
      if (gradeRows.length) await db.insert(schema.schoolGradeMappings).values(gradeRows);

      await db.delete(schema.schoolCoordinators).where(eq(schema.schoolCoordinators.schoolId, schoolId));
      const coordRows = (it.school_coordinator ?? []).map((r, i) => ({
        schoolId,
        rowIdx: i + 1,
        pocName: asText(r.poc_name),
        email: asText(r.email),
        contactNumber: asText(r.contact_number),
        alternateNumber: asText(r.alternate_number),
        role: asText(r.role),
        raw: r as unknown as Record<string, unknown>,
      }));
      if (coordRows.length) await db.insert(schema.schoolCoordinators).values(coordRows);

      await db.delete(schema.schoolUniformMappings).where(eq(schema.schoolUniformMappings.schoolId, schoolId));
      const uniRows = (it.uniform_details ?? []).map((r, i) => ({
        schoolId,
        rowIdx: i + 1,
        grade: asText(r.grade),
        organisationGivenGrade: asText(r.organisation_given_grade),
        sections: asText(r.sections),
        organisationGivenSection: asText(r.organisation_given_section),
        houseName: asText(r.house_name),
        raw: r as unknown as Record<string, unknown>,
      }));
      if (uniRows.length) await db.insert(schema.schoolUniformMappings).values(uniRows);
    } catch (e) {
      report.failed++;
      if (report.errors.length < 20) {
        report.errors.push({ entity: "School", erpName: it.name, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
}

// ─── Grades ──────────────────────────────────────────────────────

async function syncGrades(report: EducationSyncReport, cfg: ErpNextConfig): Promise<void> {
  for await (const it of iterateErpDocs<{ name: string; grade_name?: string; grade_code?: string; status?: string; modified?: string }>(
    "Grade",
    { pageSize: 200, fetchConcurrency: 5 },
    cfg
  )) {
    if (!it.name) continue;
    report.gradesScanned++;
    try {
      const existing = await db
        .select({ id: schema.grades.id })
        .from(schema.grades)
        .where(eq(schema.grades.erpName, it.name))
        .limit(1);

      const values = {
        erpName: it.name,
        gradeName: asText(it.grade_name) ?? it.name,
        gradeCode: asText(it.grade_code),
        status: asText(it.status),
        raw: it as unknown as Record<string, unknown>,
        erpModified: asTimestamp(it.modified),
        syncedAt: new Date(),
      };

      if (existing[0]) {
        await db.update(schema.grades).set(values).where(eq(schema.grades.id, existing[0].id));
        report.gradesUpdated++;
      } else {
        await db.insert(schema.grades).values(values);
        report.gradesInserted++;
      }
    } catch (e) {
      report.failed++;
      if (report.errors.length < 20) {
        report.errors.push({ entity: "Grade", erpName: it.name, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
}

// ─── Guardians ───────────────────────────────────────────────────

async function syncGuardians(
  report: EducationSyncReport,
  opts: EducationSyncOptions,
  cfg: ErpNextConfig
): Promise<void> {
  for await (const it of iterateErpDocs<{
    name: string;
    guardian_name?: string;
    email_address?: string;
    mobile_number?: string;
    email?: string;
    alternate_number?: string;
    date_of_birth?: string;
    modified?: string;
  }>(
    "Guardians",
    { pageSize: 500, fetchConcurrency: 10, maxRows: opts.maxGuardians },
    cfg
  )) {
    if (!it.name) continue;
    report.guardiansScanned++;
    try {
      const existing = await db
        .select({
          id: schema.guardians.id,
          mobileNumber: schema.guardians.mobileNumber,
          alternateNumber: schema.guardians.alternateNumber,
        })
        .from(schema.guardians)
        .where(eq(schema.guardians.erpName, it.name))
        .limit(1);

      // Phones are normalised to last-10 digits on every sync so dirty ERP
      // values ("-9121841763", "+91 98765 43210") never reach the DB.
      const incomingMobile = last10(asText(it.mobile_number));
      const incomingAlt = last10(asText(it.alternate_number));

      const values: Record<string, unknown> = {
        erpName: it.name,
        guardianName: asText(it.guardian_name),
        emailAddress: asText(it.email_address),
        mobileNumber: incomingMobile,
        email: asText(it.email),
        alternateNumber: incomingAlt,
        dateOfBirth: asText(it.date_of_birth),
        raw: it as unknown as Record<string, unknown>,
        erpModified: asTimestamp(it.modified),
        syncedAt: new Date(),
      };

      if (existing[0]) {
        // Preserve manual phone corrections: if the DB already holds a phone
        // and it disagrees with the (normalised) ERP value, the DB wins.
        // Same for the alternate number. Empty/null DB cells still fill
        // from ERP so new contact details flow through.
        if (existing[0].mobileNumber && existing[0].mobileNumber !== incomingMobile) {
          values.mobileNumber = existing[0].mobileNumber;
        }
        if (existing[0].alternateNumber && existing[0].alternateNumber !== incomingAlt) {
          values.alternateNumber = existing[0].alternateNumber;
        }
        await db.update(schema.guardians).set(values).where(eq(schema.guardians.id, existing[0].id));
        report.guardiansUpdated++;
      } else {
        await db.insert(schema.guardians).values(values);
        report.guardiansInserted++;
      }
    } catch (e) {
      report.failed++;
      if (report.errors.length < 20) {
        report.errors.push({ entity: "Guardians", erpName: it.name, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
}

// ─── Students ────────────────────────────────────────────────────

type ErpStudent = {
  name: string;
  enabled?: number;
  is_new_student?: number;
  is_verified?: number;
  school_code?: string;
  enrollment_number?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  grade?: string;
  section?: string;
  joining_date?: string;
  house_color?: string;
  medium?: string;
  curriculum?: string;
  shoe_size?: string;
  shirt_size?: string;
  trouser_size?: string;
  profile_picture_attach?: string;
  student_email_id?: string;
  student_mobile_number?: string;
  date_of_birth?: string;
  blood_group?: string;
  gender?: string;
  nationality?: string;
  customer?: string;
  customer_group?: string;
  modified?: string;
  student_billing_addresses?: Array<Record<string, unknown>>;
  student_shipping_addresses?: Array<Record<string, unknown>>;
  guardians?: Array<Record<string, unknown>>;
  siblings?: Array<Record<string, unknown>>;
};

async function syncStudents(
  report: EducationSyncReport,
  opts: EducationSyncOptions,
  cfg: ErpNextConfig
): Promise<void> {
  for await (const it of iterateErpDocs<ErpStudent>(
    "Students",
    { pageSize: 500, fetchConcurrency: 10, maxRows: opts.maxStudents },
    cfg
  )) {
    if (!it.name) continue;
    report.studentsScanned++;
    try {
      let existing = await db
        .select({
          id: schema.students.id,
          createdAt: schema.students.createdAt,
          studentMobileNumber: schema.students.studentMobileNumber,
        })
        .from(schema.students)
        .where(eq(schema.students.erpName, it.name))
        .limit(1);
      if (existing[0] && isPostCutover(existing[0].createdAt)) continue;

      // Resolve schoolId via school_code on the canonical schools table.
      // Skip the row if no matching school exists (storefront FK is NOT NULL).
      const sc = asText(it.school_code);
      if (!sc) {
        report.failed++;
        if (report.errors.length < 20) report.errors.push({ entity: "Students", erpName: it.name, message: "no school_code on ERP row" });
        continue;
      }
      // Secondary lookup: when erp_name doesn't match anything, fall back to
      // (school_code, enrollment_number) on rows that have never been linked
      // to ERP (erp_name IS NULL or ''). Without this, an admin-added row
      // for a newly-enrolled student gets duplicated on the next sync — the
      // ERP row inserts a second copy under the same enrollment number.
      // Found rows are adopted (treated as the existing target) so the
      // update path below fills in erp_name and the rest of the ERP fields.
      const en = asText(it.enrollment_number);
      if (!existing[0] && en) {
        existing = await db
          .select({
            id: schema.students.id,
            createdAt: schema.students.createdAt,
            studentMobileNumber: schema.students.studentMobileNumber,
          })
          .from(schema.students)
          .where(
            and(
              eq(schema.students.schoolCode, sc),
              eq(schema.students.enrollmentNumber, en),
              or(isNull(schema.students.erpName), eq(schema.students.erpName, "")),
            )
          )
          .limit(1);
        if (existing[0] && isPostCutover(existing[0].createdAt)) continue;
      }
      const schoolHit = await db
        .select({ id: schema.schools.id })
        .from(schema.schools)
        .where(eq(schema.schools.schoolCode, sc))
        .limit(1);
      if (!schoolHit[0]) {
        report.failed++;
        if (report.errors.length < 20) report.errors.push({ entity: "Students", erpName: it.name, message: `no schools.school_code='${sc}'` });
        continue;
      }
      const schoolId = schoolHit[0].id;
      const displayName =
        [asText(it.first_name), asText(it.middle_name), asText(it.last_name)].filter(Boolean).join(" ") || it.name;

      // Translate ERP's grade (ERP-offset uniform value like "Grade 9") into
      // the Targeted-Grade vocabulary the storefront filters on (e.g.
      // "Grade 6"). School-local labels like "Class 5" or "JKG" are
      // resolved through school_grade_mappings inside the helper. Falls
      // back to the raw value if nothing matches.
      const toTargetedGrade = await makeTargetedGradeResolver(schoolId);
      const rawGrade = asText(it.grade);
      const targetedGrade = toTargetedGrade(rawGrade) ?? rawGrade;

      // Normalise the student mobile to last-10 digits. On update, a
      // non-empty DB value that disagrees with ERP wins — admins regularly
      // correct broken upstream numbers by hand and a sync should never
      // clobber that work.
      const incomingStudentMobile = last10(asText(it.student_mobile_number));
      const studentMobileForWrite =
        existing[0]?.studentMobileNumber &&
        existing[0].studentMobileNumber !== incomingStudentMobile
          ? existing[0].studentMobileNumber
          : incomingStudentMobile;

      const values = {
        erpName: it.name,
        name: displayName,
        schoolId,
        class: rawGrade,
        section: asText(it.section),
        status: asBool(it.enabled) ? "active" as const : "blocked" as const,
        enabled: asBool(it.enabled),
        isNewStudent: asBool(it.is_new_student),
        isVerified: asBool(it.is_verified),
        schoolCode: asText(it.school_code),
        enrollmentNumber: asText(it.enrollment_number),
        firstName: asText(it.first_name),
        middleName: asText(it.middle_name),
        lastName: asText(it.last_name),
        grade: targetedGrade,
        joiningDate: asText(it.joining_date),
        houseColor: asText(it.house_color),
        medium: asText(it.medium),
        curriculum: asText(it.curriculum),
        shoeSize: asText(it.shoe_size),
        shirtSize: asText(it.shirt_size),
        trouserSize: asText(it.trouser_size),
        profilePictureUrl: asText(it.profile_picture_attach),
        studentEmailId: asText(it.student_email_id),
        studentMobileNumber: studentMobileForWrite,
        dateOfBirth: asText(it.date_of_birth),
        bloodGroup: asText(it.blood_group),
        gender: asText(it.gender),
        nationality: asText(it.nationality),
        customerLink: asText(it.customer),
        customerGroup: asText(it.customer_group),
        erpRaw: it as unknown as Record<string, unknown>,
        erpModified: asTimestamp(it.modified),
        syncedAt: new Date(),
      };

      let studentId: string;
      if (existing[0]) {
        studentId = existing[0].id;
        await db.update(schema.students).set(values).where(eq(schema.students.id, studentId));
        report.studentsUpdated++;
      } else {
        const [row] = await db.insert(schema.students).values(values).returning({ id: schema.students.id });
        studentId = row.id;
        report.studentsInserted++;
      }

      // Replace child tables.
      await db.delete(schema.studentAddresses).where(eq(schema.studentAddresses.studentId, studentId));
      const billing = (it.student_billing_addresses ?? []).map((r, i) => ({
        studentId,
        kind: "billing",
        rowIdx: i + 1,
        addressType: asText(r.address_type),
        addressTitle: asText(r.address_title),
        addressLine1: asText(r.address_line_1),
        addressLine2: asText(r.address_line_2),
        city: asText(r.city),
        state: asText(r.state),
        country: asText(r.country),
        pincode: r.pincode != null ? String(r.pincode) : null,
        preferred: asBool(r.preferred),
        disabled: asBool(r.disabled),
        raw: r as unknown as Record<string, unknown>,
      }));
      const shipping = (it.student_shipping_addresses ?? []).map((r, i) => ({
        studentId,
        kind: "shipping",
        rowIdx: i + 1,
        addressType: asText(r.address_type),
        addressTitle: asText(r.address_title),
        addressLine1: asText(r.address_line_1),
        addressLine2: asText(r.address_line_2),
        city: asText(r.city),
        state: asText(r.state),
        country: asText(r.country),
        pincode: r.pincode != null ? String(r.pincode) : null,
        preferred: asBool(r.preferred),
        disabled: asBool(r.disabled),
        raw: r as unknown as Record<string, unknown>,
      }));
      const addrRows = [...billing, ...shipping];
      if (addrRows.length) await db.insert(schema.studentAddresses).values(addrRows);

      // student_guardian_links — phone is the canonical identifier
      // (see lib/repos/guardians.upsertGuardianLink). Snapshot prior
      // phone values keyed by guardian_erp_name so a manual phone
      // correction made in our DB wins over a stale ERP value. Then
      // upsert each ERP guardian through the shared helper, which:
      //   • dedupes by (student, phone) across re-syncs;
      //   • collapses two ERP Guardian DocType IDs sharing one phone
      //     into a single link row (the absorbed erp_name goes into
      //     known_erp_names so the admin can still trace it).
      // Finally prune any links whose phone is no longer in the latest
      // ERP payload — replaces the old DELETE-then-INSERT pass without
      // breaking the unique-phone invariant.
      const priorPhones = await db
        .select({
          guardianErpName: schema.studentGuardianLinks.guardianErpName,
          phoneNo: schema.studentGuardianLinks.phoneNo,
        })
        .from(schema.studentGuardianLinks)
        .where(eq(schema.studentGuardianLinks.studentId, studentId));
      const priorPhoneByGuardian = new Map(
        priorPhones
          .filter((p) => p.guardianErpName && p.phoneNo)
          .map((p) => [p.guardianErpName as string, p.phoneNo as string]),
      );
      const keepPhones: string[] = [];
      for (const r of it.guardians ?? []) {
        const guardianErp = asText(r.guardian);
        const erpPhone = last10(asText(r.phone_no));
        const prior = guardianErp ? priorPhoneByGuardian.get(guardianErp) ?? null : null;
        // Prefer the saved DB phone (admin correction) over the ERP one.
        const effectivePhone = last10(prior && prior !== erpPhone ? prior : erpPhone);
        if (!effectivePhone) continue; // skip phoneless guardians here — they aren't covered by the unique index
        keepPhones.push(effectivePhone);
        await upsertGuardianLink({
          studentId,
          phone: effectivePhone,
          name: asText(r.guardian_name),
          relation: asText(r.relation),
          email: asText(r.email),
          sourceGuardianErpName: guardianErp,
        });
      }
      await pruneGuardianLinksNotIn(studentId, keepPhones);

      await db.delete(schema.studentSiblings).where(eq(schema.studentSiblings.studentId, studentId));
      const sibRows = (it.siblings ?? []).map((r, i) => ({
        studentId,
        rowIdx: i + 1,
        fullName: asText(r.full_name),
        gender: asText(r.gender),
        grade: asText(r.grade),
        section: asText(r.section),
        dateOfBirth: asText(r.date_of_birth),
        raw: r as unknown as Record<string, unknown>,
      }));
      if (sibRows.length) await db.insert(schema.studentSiblings).values(sibRows);
    } catch (e) {
      report.failed++;
      if (report.errors.length < 20) {
        report.errors.push({ entity: "Students", erpName: it.name, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
}

// After a fresh import, students newly linked to a phone whose parent has
// already completed first-time setup must inherit is_verified=true — same
// rule as first-time/complete, applied retroactively so siblings added
// later don't get bounced back into the first-time flow.
async function backfillIsVerifiedFromParents(): Promise<void> {
  await db.execute(sql`
    UPDATE students s
       SET is_verified = true
     WHERE s.is_verified IS DISTINCT FROM true
       AND EXISTS (
         SELECT 1 FROM parents p
           LEFT JOIN student_guardian_links gl ON gl.student_id = s.id
           LEFT JOIN guardians g ON g.erp_name = gl.guardian_erp_name
          WHERE p.first_time_login = false
            AND p.password_hash IS NOT NULL
            AND (
              s.parent_id = p.id
              OR right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10) = p.phone
              OR right(regexp_replace(coalesce(g.mobile_number, ''), '\D', '', 'g'), 10) = p.phone
            )
       )
  `);
}

// ─── Driver ──────────────────────────────────────────────────────

export async function runErpNextEducationSync(
  opts: EducationSyncOptions = {},
  cfg: ErpNextConfig = {}
): Promise<EducationSyncReport> {
  const startedAt = new Date();
  const startMs = Date.now();
  const report: EducationSyncReport = {
    schoolsScanned: 0, schoolsInserted: 0, schoolsUpdated: 0,
    gradesScanned: 0, gradesInserted: 0, gradesUpdated: 0,
    guardiansScanned: 0, guardiansInserted: 0, guardiansUpdated: 0,
    studentsScanned: 0, studentsInserted: 0, studentsUpdated: 0,
    failed: 0, errors: [],
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    durationMs: 0,
  };

  // Schools and grades first — small and useful for resolving references.
  await syncSchools(report, cfg);
  await syncGrades(report, cfg);

  if (!opts.skipLarge) {
    await syncGuardians(report, opts, cfg);
    await syncStudents(report, opts, cfg);
    await backfillIsVerifiedFromParents();
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startMs;
  return report;
}
