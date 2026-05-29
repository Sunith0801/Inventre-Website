-- 0023_phone_trigger_safety_net.sql
--
-- Belt-and-braces. Even after migrations 0020 + 0021 + 0022 and the
-- application-layer rewires, a future code path could still INSERT
-- into student_guardian_links / guardians directly without going
-- through lib/repos/guardians.upsertGuardianLink. These triggers make
-- phone-canonical correctness a DB invariant rather than a code
-- convention.
--
-- (A) BEFORE INSERT OR UPDATE OF phone_no on student_guardian_links:
--     normalise phone_no to last 10 digits; if not 10 digits, NULL.
-- (B) BEFORE INSERT OR UPDATE OF mobile_number / alternate_number on
--     guardians: same normalisation.
-- (C) AFTER INSERT, UPDATE OF phone_no, OR DELETE on
--     student_guardian_links: recompute students.parent_id for the
--     affected student using the same rule as
--     lib.repos.guardians.recomputeStudentParent (lowest-row_idx
--     10-digit link → matching parents.phone, else NULL).
--
-- Idempotent: CREATE OR REPLACE on functions; DROP TRIGGER IF EXISTS
-- before CREATE TRIGGER so re-runs replace rather than fail.

BEGIN;

-- ─── (A) student_guardian_links.phone_no normaliser ───────────────────
CREATE OR REPLACE FUNCTION sgl_normalise_phone() RETURNS TRIGGER AS $$
DECLARE
  digits text;
BEGIN
  IF NEW.phone_no IS NOT NULL THEN
    digits := right(regexp_replace(NEW.phone_no, '\D', '', 'g'), 10);
    IF length(digits) = 10 THEN
      NEW.phone_no := digits;
    ELSE
      -- Half-formed / non-numeric phone: store NULL rather than the
      -- raw garbage so phone-keyed queries can't be tricked into
      -- thinking '+91 9574' belongs to anyone.
      NEW.phone_no := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sgl_normalise_phone_trg ON student_guardian_links;
CREATE TRIGGER sgl_normalise_phone_trg
  BEFORE INSERT OR UPDATE OF phone_no ON student_guardian_links
  FOR EACH ROW EXECUTE FUNCTION sgl_normalise_phone();

-- ─── (B) guardians.mobile_number + alternate_number normaliser ────────
CREATE OR REPLACE FUNCTION guardians_normalise_phones() RETURNS TRIGGER AS $$
DECLARE
  m text;
  a text;
BEGIN
  IF NEW.mobile_number IS NOT NULL THEN
    m := right(regexp_replace(NEW.mobile_number, '\D', '', 'g'), 10);
    NEW.mobile_number := CASE WHEN length(m) = 10 THEN m ELSE NULL END;
  END IF;
  IF NEW.alternate_number IS NOT NULL THEN
    a := right(regexp_replace(NEW.alternate_number, '\D', '', 'g'), 10);
    NEW.alternate_number := CASE WHEN length(a) = 10 THEN a ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guardians_normalise_phones_trg ON guardians;
CREATE TRIGGER guardians_normalise_phones_trg
  BEFORE INSERT OR UPDATE OF mobile_number, alternate_number ON guardians
  FOR EACH ROW EXECUTE FUNCTION guardians_normalise_phones();

-- ─── (C) students.parent_id auto-recompute on link change ─────────────
CREATE OR REPLACE FUNCTION students_recompute_parent_for(p_student uuid) RETURNS void AS $$
DECLARE
  v_n10 text;
  v_target uuid;
  v_current uuid;
BEGIN
  -- Lowest-row_idx 10-digit link wins; mirrors lib.repos.guardians.recomputeStudentParent.
  SELECT right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10)
    INTO v_n10
    FROM student_guardian_links
   WHERE student_id = p_student
     AND length(right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10)) = 10
   ORDER BY row_idx ASC, id ASC
   LIMIT 1;

  IF v_n10 IS NULL THEN
    v_target := NULL;
  ELSE
    SELECT id INTO v_target FROM parents WHERE phone = v_n10 LIMIT 1;
  END IF;

  SELECT parent_id INTO v_current FROM students WHERE id = p_student;
  IF v_current IS DISTINCT FROM v_target THEN
    UPDATE students SET parent_id = v_target WHERE id = p_student;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sgl_reparent_after_change() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM students_recompute_parent_for(OLD.student_id);
    RETURN OLD;
  ELSE
    PERFORM students_recompute_parent_for(NEW.student_id);
    -- Cover the rare case where an UPDATE changed student_id too.
    IF TG_OP = 'UPDATE' AND OLD.student_id IS DISTINCT FROM NEW.student_id THEN
      PERFORM students_recompute_parent_for(OLD.student_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sgl_reparent_after_change_trg ON student_guardian_links;
CREATE TRIGGER sgl_reparent_after_change_trg
  AFTER INSERT OR UPDATE OF phone_no, row_idx, student_id OR DELETE ON student_guardian_links
  FOR EACH ROW EXECUTE FUNCTION sgl_reparent_after_change();

-- The application-layer recomputeStudentParent in TS does the same work;
-- this trigger is a defence in depth so the invariant holds even if a
-- future code path inserts a link row directly.

COMMIT;
