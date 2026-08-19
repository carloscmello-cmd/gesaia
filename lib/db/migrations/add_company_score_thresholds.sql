-- Optional company-specific scorecard thresholds.
-- When null, reports retain the default: green >= 70, yellow >= 40.
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "score_thresholds" jsonb;