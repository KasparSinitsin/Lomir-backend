BEGIN;

ALTER TABLE team_applications
ADD COLUMN IF NOT EXISTS role_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'team_applications_role_id_fkey'
  ) THEN
    ALTER TABLE team_applications
    ADD CONSTRAINT team_applications_role_id_fkey
    FOREIGN KEY (role_id)
    REFERENCES team_vacant_roles(id)
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_team_applications_role_id
ON team_applications(role_id);

COMMIT;

-- Verification
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'team_applications'
ORDER BY ordinal_position;
