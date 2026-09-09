-- 0067: Full audit-trail columns on activity_log
--
-- Upgrades the existing activity_log (actor_email/action/summary/diff) into a
-- complete, record-level audit trail per the admin spec:
--   Date & Time · User Name · User Role · Action · Field(s) Changed ·
--   Old Value · New Value · Remarks · IP Address.
--
-- We extend the in-use `activity_log` (102 rows) rather than the empty,
-- never-wired `audit_log` table — keeping one log everything reads from.
--   • actor_name  — display name of the admin who acted (was email-only)
--   • actor_role  — the admin's role at action time ("super"/"ops"/…),
--                   frozen so later role changes don't rewrite history
--   • changes     — structured [{field, label, old, new}] for the
--                   per-field Old→New table (the free-form `diff` stays
--                   for snapshot-style payloads)
--   • remarks     — optional note attached to the action (e.g. cancel reason)
--   • ip          — request IP (optional)
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) so the file-based migrator can re-run.

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS actor_name text;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS actor_role text;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS changes    jsonb;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS remarks    text;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS ip         text;
