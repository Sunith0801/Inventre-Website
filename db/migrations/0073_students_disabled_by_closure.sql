-- Site-wide storefront closure bookkeeping.
--
-- The master Open/Closed switch on /admin/students disables every student
-- in one click. Re-opening must NOT blanket-enable everyone: students who
-- were already disabled individually (left the school, duplicate row, an
-- account under investigation) have to STAY disabled. So the closure marks
-- the rows it switched off, and re-opening restores exactly those.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS disabled_by_closure boolean NOT NULL DEFAULT false;

-- Only ever queried as "the rows the closure touched", which is empty
-- while the store is open — a partial index keeps it near-zero cost.
CREATE INDEX IF NOT EXISTS students_disabled_by_closure_idx
  ON students (disabled_by_closure)
  WHERE disabled_by_closure;
