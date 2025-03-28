const db = require('../../config/database');

const createUserTagsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_tags (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
        UNIQUE(user_id, tag_id)
      );
    `);
    console.log('User Tags table created successfully');
  } catch (error) {
    console.error('Error creating user_tags table:', error);
    throw error;
  }
};

module.exports = createUserTagsTable;