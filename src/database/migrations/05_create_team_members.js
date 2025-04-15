const db = require('../../config/database');

const createTeamMembersTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(50) DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(team_id, user_id)
      );
    `);
    console.log('Team Members table created successfully');
  } catch (error) {
    console.error('Error creating team_members table:', error);
    throw error;
  }
};

module.exports = createTeamMembersTable;