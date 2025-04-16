const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/auth');
const upload = require('../middlewares/uploadMiddleware');
const db = require('../config/database');

// Register a new user (with optional avatar upload)
router.post('/register', 
  upload.single('avatar'),  // Handles avatar file upload
  authController.register
);

// Login existing user
router.post('/login', authController.login);

// Get current user (requires token)
router.get('/me', authenticateToken, authController.getCurrentUser);

// Test endpoint to view latest users
router.get('/test-users', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users ORDER BY id DESC LIMIT 10');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Database connection test
router.get('/db-test-connection', async (req, res) => {
  try {
    const timeResult = await db.query('SELECT NOW() as current_time');
    const tableResult = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'users'
    `);
    
    res.json({
      current_time: timeResult.rows[0].current_time,
      users_table_exists: tableResult.rows.length > 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get database and table info
router.get('/db-info', async (req, res) => {
  try {
    const dbInfo = await db.query('SELECT current_database() as database, current_schema() as schema');
    const tableList = await db.query(`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    res.json({
      connection: dbInfo.rows[0],
      tables: tableList.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get the 10 latest registered users
router.get('/check-latest-users', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, username, email, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;