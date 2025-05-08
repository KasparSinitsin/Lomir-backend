const db = require('../../config/database');

const addUserVisibilityColumn = async () => {
  try {
    await db.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE
    `);
    console.log('Added is_public column to users table');
  } catch (error) {
    console.error('Error adding is_public column:', error);
    throw error;
  }
};

module.exports = addUserVisibilityColumn;