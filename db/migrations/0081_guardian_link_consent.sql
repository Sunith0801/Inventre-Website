-- P-11 (Data Protection plan): record, per child, when the parent who linked
-- that child to their account accepted the terms/privacy notice, and which
-- version. Only the parent self-service flows stamp this; admin and roster
-- imports leave it NULL (the school's consent basis applies there).
ALTER TABLE student_guardian_links ADD COLUMN IF NOT EXISTS consent_version text;
ALTER TABLE student_guardian_links ADD COLUMN IF NOT EXISTS consent_recorded_at timestamptz;
