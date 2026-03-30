BEGIN;

ALTER TABLE team_invitations
ADD COLUMN IF NOT EXISTS role_id INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'team_invitations_role_id_fkey'
  ) THEN
    ALTER TABLE team_invitations
    ADD CONSTRAINT team_invitations_role_id_fkey
    FOREIGN KEY (role_id)
    REFERENCES team_vacant_roles(id)
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_team_invitations_role_id
ON team_invitations(role_id);

COMMIT;

-- Verification
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'team_invitations'
ORDER BY ordinal_position;
