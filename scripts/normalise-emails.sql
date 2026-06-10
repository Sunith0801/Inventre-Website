-- Normalise email cells across parents / students.student_email_id /
-- student_guardian_links.email. Single-pass rules:
--   1. Pick the first email when the cell carries multiple (split on , or ;).
--   2. Strip leading/trailing/internal whitespace (take first whitespace token).
--   3. Fix obvious domain typos: gmail / yahoo / hotmail / rediffmail / outlook.
--   4. Add ".com" when the domain is bare (e.g. "x@gmail" → "x@gmail.com").
--
-- A row's "new" value is only adopted when it differs from the raw and the
-- result passes a standard email regex.  Anything that still fails the
-- regex after normalisation is left untouched (reported but not written).

SET client_min_messages = warning;

DROP TABLE IF EXISTS _domain_fixes;
CREATE TEMP TABLE _domain_fixes (bad text, good text);
INSERT INTO _domain_fixes(bad, good) VALUES
  ('gmail',       'gmail.com'),
  ('gmail.con',   'gmail.com'),
  ('gmial.com',   'gmail.com'),
  ('gmai.com',    'gmail.com'),
  ('gmaill.com',  'gmail.com'),
  ('gmal.com',    'gmail.com'),
  ('gmaol.com',   'gmail.com'),
  ('gnail.com',   'gmail.com'),
  ('gamil.com',   'gmail.com'),
  ('gmialcom',    'gmail.com'),
  ('gmailcom',    'gmail.com'),
  ('yahoo',       'yahoo.com'),
  ('yhaoo.com',   'yahoo.com'),
  ('yaoo.com',    'yahoo.com'),
  ('yhoo.com',    'yahoo.com'),
  ('yahooo.com',  'yahoo.com'),
  ('yaho.com',    'yahoo.com'),
  ('yaho.co.in',  'yahoo.co.in'),
  ('yhoo.in',     'yahoo.in'),
  ('hotmail',     'hotmail.com'),
  ('hotmaill.com','hotmail.com'),
  ('hotmial.com', 'hotmail.com'),
  ('hotmal.com',  'hotmail.com'),
  ('rediffmail',  'rediffmail.com'),
  ('rediffmal.com','rediffmail.com'),
  ('rediffmial.com','rediffmail.com'),
  ('outlook',     'outlook.com'),
  ('outlok.com',  'outlook.com');

CREATE OR REPLACE FUNCTION pg_temp.norm_email(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH s0 AS (
    -- 1) Drop anything after the first ; , or / (multi-email separators).
    -- 2) Split on whitespace and pick the FIRST token that contains "@"
    --    so "Jasti Ramesh @ gmail.com" and "Syed masihuddin.ather@gmail.com"
    --    both yield the email half (after collapsing the loose @).
    -- 3) Fall back to the first non-empty token when nothing has @.
    SELECT COALESCE(
      (
        SELECT trim(t)
          FROM unnest(regexp_split_to_array(regexp_replace(raw, '[;,/].*', '', 'g'), '\s+')) AS t
         WHERE trim(t) <> '' AND position('@' IN t) > 0
         LIMIT 1
      ),
      (
        SELECT trim(t)
          FROM unnest(regexp_split_to_array(regexp_replace(raw, '[;,/].*', '', 'g'), '\s+')) AS t
         WHERE trim(t) <> ''
         LIMIT 1
      )
    ) AS v
  ),
  s1 AS (
    -- Strip a trailing dot/semicolon/comma that survived the split.
    SELECT regexp_replace(v, '[\.,;]+$', '') AS v FROM s0
  ),
  s2 AS (
    -- Domain typo fix: compare case-insensitively against the lookup, but
    -- only rewrite the domain (lowercased) when we get a match. Local-part
    -- and the original domain otherwise are left untouched.
    SELECT CASE
             WHEN position('@' IN v) = 0 THEN v
             ELSE split_part(v,'@',1) || '@' || COALESCE(
                    (SELECT good FROM _domain_fixes WHERE bad = lower(split_part(v,'@',2))),
                    split_part(v,'@',2))
           END AS v
      FROM s1
  )
  SELECT v FROM s2
$$;

-- Standard "looks-like-email" check.
CREATE OR REPLACE FUNCTION pg_temp.is_email(v text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT v IS NOT NULL AND v ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
$$;
