CREATE TABLE IF NOT EXISTS otp_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          VARCHAR(10) NOT NULL,
  purpose        TEXT NOT NULL,
  event          TEXT NOT NULL,
  transaction_id TEXT,
  error          TEXT,
  ip             TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_logs_phone_idx ON otp_logs(phone);
CREATE INDEX IF NOT EXISTS otp_logs_created_idx ON otp_logs(created_at);
