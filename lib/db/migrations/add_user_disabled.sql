-- Add disabled flag to users for access revocation without hard-deletion.
-- requireAuth blocks any Clerk identity whose row has disabled=true, preventing
-- re-provisioning. Safe to run repeatedly (idempotent).
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "disabled" boolean NOT NULL DEFAULT false;
