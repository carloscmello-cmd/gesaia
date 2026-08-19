-- Migration: add company_id to conversations so cascade delete works
-- even after the linked investigation is removed (conversationId on investigation becomes null)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id) ON DELETE CASCADE;
