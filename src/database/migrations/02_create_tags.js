const db = require('../../config/database');

const createTagsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        category VARCHAR(50)
      );
    `);
    console.log('Tags table created successfully');
  } catch (error) {
    console.error('Error creating tags table:', error);
    throw error;
  }
};

module.exports = createTagsTable;