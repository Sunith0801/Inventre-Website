-- =====================================================================
-- Inventre — Bookkit mapping recovery bundle
-- Captured: 2026-05-27 (IST)
-- Source branch: wip/bookkit-mapping-fix
--
-- This file is a single-shot copy of every schema/data change applied
-- locally during the 2026-05-27 bookkit-mapping recovery. It is a flat
-- replay of:
--
--     db/migrations/0038_kit_grade_cleanup.sql
--     db/migrations/0039_bookkit_variant_recovery.sql
--     db/migrations/0040_bookkit_duplicate_template_resolve.sql
--     db/migrations/0041_kit_grade_internal_remap.sql
--     db/migrations/0042_reactivate_kits_with_boms.sql
--
-- The repo migrator (db/migrate.ts) will apply 0038 + 0039 individually
-- on deploy via the `__schema_migrations` table — this combined file is
-- here ONLY as a manual fallback (rollback reference, ad-hoc psql replay,
-- or attaching to a DBA ticket). Do NOT add it to the migrations folder;
-- doing so would re-execute the statements outside the migrator's
-- bookkeeping. Every statement below is idempotent (filtered WHERE
-- clauses, ON CONFLICT DO NOTHING, IF NOT EXISTS), so re-running is safe.
--
-- Usage (manual replay):
--     docker exec -i inventre-deploy-postgres \
--       psql -U inventre -d inventre < this-file.sql
--
-- One script that computes derived state must be run on prod AFTER this
-- migration lands (lives in scripts/ in the same commit):
--     npx tsx scripts/import-bom-csv.ts
--
-- Followed by a read-only verification pass:
--     npx tsx scripts/audit-bookkit-mappings.ts
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0038 — Kit grade cleanup (cross-grade pruning)                   ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
-- The ERPNext item feed ships `custom_grade` as a comma-separated list,
-- and for many "<School> Grade N Bookkit" rows that list contains
-- spurious extra grades (e.g. "Grade 3, Grade 6"). The ERP item
-- importer (lib/importers/erp-item.ts) was copying these verbatim into
-- `product_grades`, so on the storefront a Grade 6 student was seeing
-- "SMS Grade 3 Bookkit" cards.
--
-- Fix: when a kit's name encodes a canonical grade ("Grade N", "LKG",
-- "UKG", "Nursery"), trust the name as authoritative and drop every
-- other product_grades row for that product. The importer was updated
-- in the same commit to apply this rule on each ERP sync going forward.
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

WITH kit_name_grade AS (
  SELECT
    p.id,
    CASE
      WHEN p.name ~* '\mGrade[ \-_]?(\d{1,2})\M' THEN
        'Grade ' || (regexp_match(p.name, 'Grade[ \-_]?(\d{1,2})', 'i'))[1]
      WHEN p.name ~* '\mNursery\M' THEN 'Nursery'
      WHEN p.name ~* '\mLKG\M'     THEN 'LKG'
      WHEN p.name ~* '\mUKG\M'     THEN 'UKG'
      ELSE NULL
    END AS canonical_grade
  FROM products p
  WHERE p.kind = 'kit'
)
DELETE FROM product_grades pg
USING kit_name_grade k
WHERE pg.product_id = k.id
  AND k.canonical_grade IS NOT NULL
  AND pg.grade <> k.canonical_grade;

INSERT INTO product_grades (product_id, grade)
SELECT k.id, k.canonical_grade
  FROM (
    SELECT
      p.id,
      CASE
        WHEN p.name ~* '\mGrade[ \-_]?(\d{1,2})\M' THEN
          'Grade ' || (regexp_match(p.name, 'Grade[ \-_]?(\d{1,2})', 'i'))[1]
        WHEN p.name ~* '\mNursery\M' THEN 'Nursery'
        WHEN p.name ~* '\mLKG\M'     THEN 'LKG'
        WHEN p.name ~* '\mUKG\M'     THEN 'UKG'
        ELSE NULL
      END AS canonical_grade
    FROM products p
    WHERE p.kind = 'kit'
  ) k
 WHERE k.canonical_grade IS NOT NULL
ON CONFLICT (product_id, grade) DO NOTHING;

COMMIT;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0039 — Bookkit variant recovery (2026-05-27)                     ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
-- BOM.csv ships language/stream variants of each Bookkit as concatenated
-- suffixes ("SMS Grade 6 BookkitHindi 2nd Lan Tel 3rd Lan"). An earlier
-- import path created these as standalone products without linking them
-- to the template Bookkit, so:
--   - "SMS Grade 6 Bookkit" (template) had no product_bundles row and
--     no product_variants picker rows → the PDP fell back to the
--     "Kit contents are being updated. Check back soon." message.
--   - The standalone variant products were unreachable from the
--     storefront (filtered by `is_variant_item = false`).
-- scripts/import-bom-csv.ts in the same commit now writes these links
-- correctly; this migration normalises any pre-existing rows so the
-- importer can reach a clean steady state.
--
-- The fixes mirror the patterns from 0035 (admin batch 2026-05-26):
--   1) Reactivate every bundle-class product_variant (the cart drops
--      inactive variants on read — soft-deleted variants make kits
--      vanish from carts on next refresh).
--   2) Variant dedup for kit-class products — kit variants must have
--      unique `size` values or the PDP picker collapses duplicates.
--   3) Repoint stale "Bookkit-less" variant sizes (e.g.
--      "SMS Grade 6 Hindi 2nd Lan Tel 3rd Lan") to their sku
--      (which preserves the literal "Bookkit" word) so
--      lib/bookkit-langs.ts:parseBookkitLangs picks them up.
-- ──────────────────────────────────────────────────────────────────────

-- ── 1. Reactivate every bundle-class product_variant ─────────────────
-- Carries the 0035 §1 invariant forward. A bookkit variant that goes
-- inactive disappears from carts (lib/repos/cart.ts) and from the PDP
-- language picker (lib/repos/products.ts filters isActive=true).
UPDATE product_variants pv
   SET is_active = true
  FROM products p
 WHERE pv.product_id = p.id
   AND p.kind::text IN ('kit','sub_bundle','magic_box','bookkit')
   AND pv.is_active = false;

-- ── 2. Promote sku → size for bundle-variant rows whose size lacks ──
--     the literal "Bookkit" word.
-- lib/bookkit-langs.ts:parseBookkitLangs requires "bookkit" in the size
-- to detect language pairs. Pre-existing rows had the school+grade in
-- size but stripped "Bookkit" (e.g. "SMS Grade 6 Hindi 2nd Lan Tel
-- 3rd Lan"); the corresponding sku still carries the word. Push sku
-- into size so the parser fires. Idempotent: subsequent runs match no
-- rows (size now contains "bookkit").
UPDATE product_variants pv
   SET size = pv.sku
  FROM products p
 WHERE pv.product_id = p.id
   AND p.kind::text IN ('kit','sub_bundle','magic_box','bookkit')
   AND pv.size !~* 'bookkit'
   AND pv.sku   ~* 'bookkit';

-- ── 3. Variant dedup for kit-class products ─────────────────────────
-- Mirrors 0035 §4. After step 2 some sizes may collide (two variants
-- promoted to the same sku → impossible, sku is UNIQUE; but legacy
-- dupes from earlier imports still exist). When a duplicate `size`
-- shows up on a kit/bundle product, promote the unique `sku` into
-- `size` so the PDP doesn't collapse the picker options.
UPDATE product_variants pv
   SET size = pv.sku
  FROM products p
 WHERE pv.product_id = p.id
   AND p.kind::text IN ('kit','sub_bundle','magic_box','bookkit')
   AND EXISTS (
     SELECT 1 FROM product_variants pv2
      WHERE pv2.product_id = pv.product_id
        AND pv2.size = pv.size
        AND pv2.id <> pv.id
   );

-- ── 4. Re-analyze affected tables so the planner sees the new shape ──
ANALYZE product_variants;
ANALYZE product_grades;
ANALYZE products;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0040 — Bookkit duplicate template resolve (2026-05-27)           ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
-- Seven Bookkit template products existed twice in `products` — one
-- row from an earlier ERP sync (status='active', no BOM linkage) and
-- a second row from the BOM importer with an auto-suffixed slug
-- (status='draft', carries the language-variant product_variants
-- rows). The storefront filters by status='active', so parents were
-- landing on the empty row and seeing the "Kit contents are being
-- updated…" message even after 0039 attached BOMs to the other half.
--
-- For each duplicate-name kit: promote the variant-bearing row to
-- status='active', archive the empty one. Idempotent: subsequent
-- runs match zero rows.
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

WITH dup_groups AS (
  SELECT name
    FROM products
   WHERE kind = 'kit' AND name ILIKE '%Bookkit%'
   GROUP BY name
  HAVING COUNT(*) > 1
),
ranked AS (
  SELECT
    p.id,
    p.name,
    p.status::text AS status_text,
    (SELECT COUNT(*)
       FROM product_variants v
      WHERE v.product_id = p.id AND v.is_active) AS active_variants
    FROM products p
   WHERE p.kind = 'kit'
     AND p.name IN (SELECT name FROM dup_groups)
),
pairs AS (
  SELECT
    name,
    (ARRAY_AGG(id ORDER BY active_variants DESC,
                          CASE WHEN status_text='active' THEN 0 ELSE 1 END))[1]
      AS keep_id,
    (ARRAY_AGG(id ORDER BY active_variants ASC,
                          CASE WHEN status_text='active' THEN 1 ELSE 0 END))[1]
      AS archive_id
  FROM ranked
  GROUP BY name
)
SELECT * INTO TEMP TABLE _dup_pairs FROM pairs;

UPDATE products p
   SET status = 'active'
  FROM _dup_pairs d
 WHERE p.id = d.keep_id
   AND p.status <> 'active';

UPDATE products p
   SET status = 'archived'
  FROM _dup_pairs d
 WHERE p.id = d.archive_id
   AND p.id <> d.keep_id
   AND p.status <> 'archived';

DROP TABLE _dup_pairs;

ANALYZE products;

COMMIT;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0041 — Kit grade internal remap (2026-05-27)                     ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
-- 0038 incorrectly kept the school-given grade encoded in the product
-- name and deleted the school's INTERNAL grade tag. Schools such as
-- SAS Suchitra, SMS, and Kidlink store student.grade in an internal
-- enumeration (recorded in `school_grade_mappings.grade`) that does
-- NOT match the school-given label used in the product name. Example:
--
--   SAS Suchitra:  Class 12  → student.grade = "Grade 15"
--   SMS:           Class 6   → student.grade = "Grade 9"
--
-- The storefront filter joins on student.grade — so a product tagged
-- solely with the school-given label was invisible to every student of
-- the relevant class.
--
-- Fix: for every (kit, school) pair, translate the name-encoded
-- school-given grade into the internal grade via school_grade_mappings,
-- INSERT the internal grade, and DELETE the school-given tag when it
-- differs. Idempotent.
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

WITH kit_school AS (
  SELECT
    p.id   AS product_id,
    ps.school_id,
    CASE
      WHEN p.name ~* '\mGrade[ \-_]?(\d{1,2})\M' THEN
        'Grade ' || (regexp_match(p.name, 'Grade[ \-_]?(\d{1,2})', 'i'))[1]
      WHEN p.name ~* '\mNursery\M' THEN 'Nursery'
      WHEN p.name ~* '\mLKG\M'     THEN 'LKG'
      WHEN p.name ~* '\mUKG\M'     THEN 'UKG'
      ELSE NULL
    END AS school_given_grade
  FROM products p
  JOIN product_school ps ON ps.product_id = p.id
  WHERE p.kind = 'kit'
),
resolved AS (
  SELECT
    ks.product_id,
    ks.school_given_grade,
    sgm.grade AS internal_grade
  FROM kit_school ks
  JOIN school_grade_mappings sgm
    ON sgm.school_id = ks.school_id
   AND lower(sgm.school_given_grade_name) = lower(ks.school_given_grade)
  WHERE ks.school_given_grade IS NOT NULL
)
INSERT INTO product_grades (product_id, grade)
SELECT DISTINCT r.product_id, r.internal_grade
  FROM resolved r
 WHERE r.internal_grade IS NOT NULL
ON CONFLICT (product_id, grade) DO NOTHING;

WITH kit_school AS (
  SELECT
    p.id   AS product_id,
    ps.school_id,
    CASE
      WHEN p.name ~* '\mGrade[ \-_]?(\d{1,2})\M' THEN
        'Grade ' || (regexp_match(p.name, 'Grade[ \-_]?(\d{1,2})', 'i'))[1]
      WHEN p.name ~* '\mNursery\M' THEN 'Nursery'
      WHEN p.name ~* '\mLKG\M'     THEN 'LKG'
      WHEN p.name ~* '\mUKG\M'     THEN 'UKG'
      ELSE NULL
    END AS school_given_grade
  FROM products p
  JOIN product_school ps ON ps.product_id = p.id
  WHERE p.kind = 'kit'
),
to_drop AS (
  SELECT DISTINCT ks.product_id, ks.school_given_grade
  FROM kit_school ks
  JOIN school_grade_mappings sgm
    ON sgm.school_id = ks.school_id
   AND lower(sgm.school_given_grade_name) = lower(ks.school_given_grade)
   AND lower(sgm.grade) <> lower(ks.school_given_grade)
)
DELETE FROM product_grades pg
USING to_drop d
WHERE pg.product_id = d.product_id
  AND lower(pg.grade) = lower(d.school_given_grade);

ANALYZE product_grades;

COMMIT;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0042 — Reactivate kits with valid BOMs (2026-05-27)              ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
-- 48 standalone kit products (is_variant_item=false) were sitting at
-- status='archived' despite carrying active product_variants, a
-- product_bundles row, and a product_school link. The most common case
-- is "SAS Suchitra Grade 12 MBPC" and similar per-stream kits, which
-- never appeared on the storefront because the catalog query filters
-- status='active'. An earlier import cycle archived them; subsequent
-- BOM imports never promoted them back because the importer only sets
-- status on INSERT.
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE products p
   SET status = 'active'
 WHERE p.kind = 'kit'
   AND p.is_variant_item = false
   AND p.status = 'archived'
   AND EXISTS (SELECT 1 FROM product_bundles pb WHERE pb.product_id = p.id)
   AND EXISTS (SELECT 1 FROM product_variants v
                WHERE v.product_id = p.id AND v.is_active)
   AND EXISTS (SELECT 1 FROM product_school ps WHERE ps.product_id = p.id);

ANALYZE products;

COMMIT;

-- =====================================================================
-- END OF BUNDLE
-- =====================================================================
