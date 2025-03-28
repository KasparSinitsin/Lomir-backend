const db = require('../../config/database');

const createMessagesTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        receiver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW(),
        read_at TIMESTAMP
      );
    `);
    console.log('Messages table created successfully');
  } catch (error) {
    console.error('Error creating messages table:', error);
    throw error;
  }
};

module.exports = createMessagesTable;