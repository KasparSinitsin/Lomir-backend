const db = require('../../config/database');

const createTeamsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        creator_id INTEGER REFERENCES users(id),
        image_url VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        postal_code VARCHAR(20),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        max_members INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        archived_at TIMESTAMP,
        is_public BOOLEAN DEFAULT TRUE
      );
    `);
    console.log('Teams table created successfully');
  } catch (error) {
    console.error('Error creating teams table:', error);
    throw error;
  }
};

module.exports = createTeamsTable;