const db = require('../../config/database');

const createUserBadgesTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_badges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        badge_id INTEGER REFERENCES badges(id) ON DELETE CASCADE,
        awarded_by INTEGER REFERENCES users(id),
        awarded_at TIMESTAMP DEFAULT NOW(),
        team_id INTEGER REFERENCES teams(id),
        UNIQUE(user_id, badge_id, awarded_by)
      );
    `);
    console.log('User Badges table created successfully');
  } catch (error) {
    console.error('Error creating user_badges table:', error);
    throw error;
  }
};

module.exports = createUserBadgesTable;