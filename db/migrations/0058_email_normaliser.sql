-- 0058 — DB-side email normaliser (2026-06-10)
--
-- Mirrors the one-shot scrub run via scripts/normalise-emails.sql, but
-- keeps every future INSERT/UPDATE clean too. Rules:
--   1. Drop anything after the first ; , or / (multi-email separators).
--   2. Pick the first whitespace token that contains "@".
--   3. Trim trailing punctuation.
--   4. Fix known domain typos (gamil/gmial/gmai/... → gmail.com etc.).
--   5. If the result doesn't validate, return NULL.
--
-- BEFORE INSERT OR UPDATE triggers on the three email-bearing columns
-- rewrite the incoming value with the normalised form.
--
-- Local-part case is preserved. Domain case is lowercased only when a
-- typo fix kicks in (otherwise left untouched).

CREATE OR REPLACE FUNCTION normalise_email(raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v            text;
  local_part   text;
  domain       text;
  fixed_domain text;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    (SELECT btrim(t)
       FROM unnest(regexp_split_to_array(regexp_replace(raw, '[;,/].*', '', 'g'), '\s+')) AS t
      WHERE btrim(t) <> '' AND position('@' IN t) > 0
      LIMIT 1),
    (SELECT btrim(t)
       FROM unnest(regexp_split_to_array(regexp_replace(raw, '[;,/].*', '', 'g'), '\s+')) AS t
      WHERE btrim(t) <> ''
      LIMIT 1)
  ) INTO v;

  IF v IS NULL THEN RETURN NULL; END IF;
  v := regexp_replace(v, '[\.,;]+$', '');

  IF position('@' IN v) = 0 THEN
    RETURN NULL;
  END IF;

  local_part := split_part(v, '@', 1);
  domain     := split_part(v, '@', 2);

  fixed_domain := CASE lower(domain)
    WHEN 'gmail'         THEN 'gmail.com'
    WHEN 'gmail.con'     THEN 'gmail.com'
    WHEN 'gmial.com'     THEN 'gmail.com'
    WHEN 'gmai.com'      THEN 'gmail.com'
    WHEN 'gmaill.com'    THEN 'gmail.com'
    WHEN 'gmal.com'      THEN 'gmail.com'
    WHEN 'gmaol.com'     THEN 'gmail.com'
    WHEN 'gnail.com'     THEN 'gmail.com'
    WHEN 'gamil.com'     THEN 'gmail.com'
    WHEN 'gmialcom'      THEN 'gmail.com'
    WHEN 'gmailcom'      THEN 'gmail.com'
    WHEN 'yahoo'         THEN 'yahoo.com'
    WHEN 'yhaoo.com'     THEN 'yahoo.com'
    WHEN 'yaoo.com'      THEN 'yahoo.com'
    WHEN 'yhoo.com'      THEN 'yahoo.com'
    WHEN 'yahooo.com'    THEN 'yahoo.com'
    WHEN 'yaho.com'      THEN 'yahoo.com'
    WHEN 'yaho.co.in'    THEN 'yahoo.co.in'
    WHEN 'yhoo.in'       THEN 'yahoo.in'
    WHEN 'hotmail'       THEN 'hotmail.com'
    WHEN 'hotmaill.com'  THEN 'hotmail.com'
    WHEN 'hotmial.com'   THEN 'hotmail.com'
    WHEN 'hotmal.com'    THEN 'hotmail.com'
    WHEN 'rediffmail'    THEN 'rediffmail.com'
    WHEN 'rediffmal.com' THEN 'rediffmail.com'
    WHEN 'rediffmial.com' THEN 'rediffmail.com'
    WHEN 'outlook'       THEN 'outlook.com'
    WHEN 'outlok.com'    THEN 'outlook.com'
    ELSE domain
  END;

  v := local_part || '@' || fixed_domain;

  IF v ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RETURN v;
  ELSE
    RETURN NULL;
  END IF;
END
$$;

-- One trigger function per email-bearing column. Keeps the assignments
-- static so plpgsql can compile them.
CREATE OR REPLACE FUNCTION parents_normalise_email() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> '' THEN
    NEW.email := normalise_email(NEW.email);
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION students_normalise_email_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_email_id IS NOT NULL AND NEW.student_email_id <> '' THEN
    NEW.student_email_id := normalise_email(NEW.student_email_id);
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION sgl_normalise_email() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> '' THEN
    NEW.email := normalise_email(NEW.email);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS parents_normalise_email_trg            ON parents;
DROP TRIGGER IF EXISTS students_normalise_email_id_trg         ON students;
DROP TRIGGER IF EXISTS sgl_normalise_email_trg                 ON student_guardian_links;

CREATE TRIGGER parents_normalise_email_trg
  BEFORE INSERT OR UPDATE OF email ON parents
  FOR EACH ROW EXECUTE FUNCTION parents_normalise_email();

CREATE TRIGGER students_normalise_email_id_trg
  BEFORE INSERT OR UPDATE OF student_email_id ON students
  FOR EACH ROW EXECUTE FUNCTION students_normalise_email_id();

CREATE TRIGGER sgl_normalise_email_trg
  BEFORE INSERT OR UPDATE OF email ON student_guardian_links
  FOR EACH ROW EXECUTE FUNCTION sgl_normalise_email();
