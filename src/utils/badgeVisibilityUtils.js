const { pool } = require("../config/database");

const ensureBadgeVisibilityColumns = async (clientOrPool = pool) => {
  await clientOrPool.query(
    `ALTER TABLE users
     ADD COLUMN IF NOT EXISTS hide_badges BOOLEAN DEFAULT FALSE,
     ADD COLUMN IF NOT EXISTS hidden_badge_ids INTEGER[] DEFAULT '{}'::INTEGER[],
     ADD COLUMN IF NOT EXISTS hidden_award_ids INTEGER[] DEFAULT '{}'::INTEGER[]`,
  );
};

module.exports = { ensureBadgeVisibilityColumns };
