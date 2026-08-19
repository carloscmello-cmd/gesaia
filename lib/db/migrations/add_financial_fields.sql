-- Migration: add financial cycle and pro-labore fields to company_data
ALTER TABLE company_data
  ADD COLUMN IF NOT EXISTS pmr numeric(6,1),
  ADD COLUMN IF NOT EXISTS pmp numeric(6,1),
  ADD COLUMN IF NOT EXISTS pme numeric(6,1),
  ADD COLUMN IF NOT EXISTS pro_labore numeric(18,4);
