const db = require('../../config/database');

const addColorToBadges = async () => {
  try {
    await db.query(`
      ALTER TABLE badges
      ADD COLUMN IF NOT EXISTS color VARCHAR(20)
    `);
    console.log('Added color column to badges table');
  } catch (error) {
    console.error('Error adding color column:', error);
    throw error;
  }
};

module.exports = addColorToBadges;