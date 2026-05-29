-- Adds `is_setup_complete` flag to schools.
--
-- Why: the Catalog Setup hub computes a "Needs work" status from real data
-- (empty grades / no Magic Box etc.). Some schools are intentionally minimal
-- (e.g. one-grade test schools, schools that won't ship Magic Boxes). Admin
-- needs a way to silence the nag without faking the underlying data.
--
-- The flag has NO effect on parent-facing queries — it only changes how the
-- Setup hub derives the status pill for that school. Safe to add to prod.

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS is_setup_complete BOOLEAN NOT NULL DEFAULT FALSE;
