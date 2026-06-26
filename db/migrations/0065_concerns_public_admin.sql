-- 0065: Public Parent Concern Portal + Inventre admin module
--
-- Extends `concerns` (0064) so concerns can be raised by a PUBLIC (logged-out)
-- parent — capturing the name they type — and worked by the support team in
-- the Inventre admin: assignment + a message thread (replies / history).
-- All idempotent so the file-based migrator can re-run.

ALTER TABLE concerns ADD COLUMN IF NOT EXISTS contact_name      text;
ALTER TABLE concerns ADD COLUMN IF NOT EXISTS order_ref         text;   -- free-text order no. the parent enters
ALTER TABLE concerns ADD COLUMN IF NOT EXISTS assigned_to_name  text;   -- support agent the ticket is assigned to
ALTER TABLE concerns ADD COLUMN IF NOT EXISTS assigned_to_user_id uuid; -- optional FK-ish (admin users), no hard FK

-- Message thread: parent's submission + agent replies + status-change notes.
CREATE TABLE IF NOT EXISTS concern_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concern_id  uuid NOT NULL REFERENCES concerns(id) ON DELETE CASCADE,
  author      text NOT NULL,            -- 'parent' | 'agent' | 'system'
  author_name text,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS concern_messages_concern_idx ON concern_messages (concern_id, created_at);
