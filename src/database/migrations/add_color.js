const db = require('../../config/database');

const addColorColumn = async () => {
  try {
    console.log('Adding color column to badges table...');
    await db.query(`
      ALTER TABLE badges
      ADD COLUMN color VARCHAR(20)
    `);
    console.log('Color column added successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error adding color column:', error);
    process.exit(1);
  }
};

addColorColumn();