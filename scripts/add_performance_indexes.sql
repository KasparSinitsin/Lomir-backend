-- Performance indexes to reduce network transfer on heavy queries
-- Safe to run multiple times (IF NOT EXISTS)

-- Speed up unread message counts (most frequently called query)
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread
  ON messages (receiver_id, read_at)
  WHERE read_at IS NULL;

-- Speed up team message unread counts
CREATE INDEX IF NOT EXISTS idx_messages_team_unread
  ON messages (team_id, sender_id, read_at)
  WHERE read_at IS NULL AND team_id IS NOT NULL;

-- Speed up conversation listing (latest message per partner)
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver_sent
  ON messages (sender_id, receiver_id, sent_at DESC)
  WHERE team_id IS NULL;

-- Speed up team conversation listing
CREATE INDEX IF NOT EXISTS idx_messages_team_sent
  ON messages (team_id, sent_at DESC)
  WHERE team_id IS NOT NULL;

-- Speed up notification unread counts (called on every route change)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, read_at)
  WHERE read_at IS NULL;

-- Verify indexes were created
SELECT indexname, tablename
FROM pg_indexes
WHERE indexname LIKE 'idx_messages_%' OR indexname LIKE 'idx_notifications_%'
ORDER BY tablename, indexname;
