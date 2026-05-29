-- Per-school color-letter → label/hex mapping. Replaces the inline
-- `schools.color_map` JSONB blob (kept for backwards-compat read paths).
--
-- Rationale: a column-per-key shape lets the admin UI edit individual rows,
-- enables FK-style integrity from variant codes, and keeps the schema visible
-- in migration history rather than buried in JSON casts.

CREATE TABLE IF NOT EXISTS school_color_map (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  letter      TEXT NOT NULL,                -- single uppercase letter, e.g. "K"
  label       TEXT NOT NULL,                -- human name, e.g. "Khaki"
  hex         TEXT,                         -- optional swatch, e.g. "#C3B091"
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS school_color_map_school_letter_idx
  ON school_color_map (school_id, letter);

-- Backfill from the legacy JSONB column. Idempotent — uses ON CONFLICT.
-- Casts each {letter: {label, hex}} entry to a row.
INSERT INTO school_color_map (school_id, letter, label, hex)
SELECT
  s.id,
  kv.key AS letter,
  COALESCE(kv.value->>'label', kv.key) AS label,
  kv.value->>'hex' AS hex
FROM schools s
CROSS JOIN LATERAL jsonb_each(COALESCE(s.color_map, '{}'::jsonb)) AS kv
WHERE jsonb_typeof(s.color_map) = 'object'
ON CONFLICT (school_id, letter) DO NOTHING;
