-- First-time login gate. Parents added via the admin panel (or bulk) must
-- verify OTP and set their own password before they can sign in. Defaults
-- TRUE so every existing row must go through first-time setup; flipped to
-- FALSE once the parent completes it.
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS first_time_login boolean NOT NULL DEFAULT true;
