const db = require('../../config/database');

const createTeamTagsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS team_tags (
        id SERIAL PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
        UNIQUE(team_id, tag_id)
      );
    `);
    console.log('Team Tags table created successfully');
  } catch (error) {
    console.error('Error creating team_tags table:', error);
    throw error;
  }
};

module.exports = createTeamTagsTable;