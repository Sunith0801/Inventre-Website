/**
 * OBSOLETE — kept for historical reference only.
 *
 * This was a one-off backfill that bridged the old split data model
 * (`erp_schools` ↔ storefront `schools` via `erp_schools.storefront_school_id`,
 * and `erp_students.parent_id`). That model no longer exists: commit
 * "Full merge: drop erp_* prefix, one canonical schema for schools/students"
 * collapsed `erp_schools`/`erp_students` into the single canonical `schools`
 * and `students` tables. There is no `storefront_school_id` column anymore,
 * so the original logic can neither type-check nor run.
 *
 * Intentionally a no-op. Do not delete the file (preserves history); if a
 * future re-bridge is ever needed, write a fresh script against the unified
 * schema instead of resurrecting this one.
 *
 *   tsx scripts/unify-schools-students.ts
 */

(async () => {
  console.log(
    "[unify-schools-students] obsolete: the erp_* split model was merged " +
      "into the canonical schools/students tables. Nothing to do."
  );
  process.exit(0);
})();
