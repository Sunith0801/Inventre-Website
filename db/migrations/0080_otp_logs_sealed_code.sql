-- P-01 (Data Protection plan): OTP codes are no longer stored in plain text.
-- The app now writes an AES-256-GCM sealed value (`enc:<iv>:<tag>:<ct>`), which
-- does not fit VARCHAR(6). Widen the column; legacy plain-text rows are sealed
-- by scripts/otp-logs-seal-legacy.ts and, as a backstop, codes older than
-- 24 hours are nulled by the data-retention cron (owner decision 2026-09-24).
ALTER TABLE otp_logs ALTER COLUMN otp_code TYPE text;
