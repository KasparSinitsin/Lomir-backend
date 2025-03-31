const express = require('express');
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/auth');
const db = require('../config/database');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', authenticateToken, authController.getCurrentUser);

// Route to testEndpoint to view latest users
router.get('/test-users', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM users ORDER BY id DESC LIMIT 10');
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/db-test-connection', async (req, res) => {
    try {
      const result = await db.query('SELECT NOW() as current_time');
      const tableCheck = await db.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      `);
      
      res.json({
        current_time: result.rows[0].current_time,
        users_table_exists: tableCheck.rows.length > 0
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

// Add the new db-info endpoint here
router.get('/db-info', async (req, res) => {
  try {
    // Get database name
    const dbInfoResult = await db.query('SELECT current_database() as database, current_schema() as schema');
    
    // Get table information
    const tableInfoResult = await db.query(`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    res.json({
      connection: {
        database: dbInfoResult.rows[0].database,
        schema: dbInfoResult.rows[0].schema
      },
      tables: tableInfoResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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