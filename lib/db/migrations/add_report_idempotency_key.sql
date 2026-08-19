ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS reports_idempotency_key_unique
  ON reports (idempotency_key);