const db = require('../../config/database');

const createBadgesTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS badges (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        category VARCHAR(50),
        image_url VARCHAR(255)
      );
    `);
    console.log('Badges table created successfully');
  } catch (error) {
    console.error('Error creating badges table:', error);
    throw error;
  }
};

module.exports = createBadgesTable;