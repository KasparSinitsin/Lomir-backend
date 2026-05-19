-- The original unique constraint on (team_id, invitee_id) was created before
-- role_id was added to team_invitations. It blocks the deferred-invite flow:
-- when a user already has a general invitation in a team, inserting a
-- role-specific invite for the same user+team fails.
--
-- This migration replaces it with two partial unique indexes that are
-- role-aware and only enforce uniqueness on pending invitations (so a user
-- can receive a new invite after a previous one was declined/accepted).

BEGIN;

-- Drop the old broad constraint
ALTER TABLE team_invitations
  DROP CONSTRAINT IF EXISTS team_invitations_team_id_invitee_id_key;

-- One pending general invitation (no role) per user per team
CREATE UNIQUE INDEX IF NOT EXISTS team_invitations_unique_general_pending
  ON team_invitations (team_id, invitee_id)
  WHERE role_id IS NULL AND status = 'pending';

-- One pending role invitation per user per team per role
CREATE UNIQUE INDEX IF NOT EXISTS team_invitations_unique_role_pending
  ON team_invitations (team_id, invitee_id, role_id)
  WHERE role_id IS NOT NULL AND status = 'pending';

COMMIT;

-- Verification
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'team_invitations'
ORDER BY indexname;
