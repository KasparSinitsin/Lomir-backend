const express = require('express');
const searchController = require('../controllers/searchController');
const { authenticateToken, optionalAuthenticateToken } = require('../middlewares/auth');

const router = express.Router();

// Use optional authentication for routes that can work with or without authentication
router.get('/all', optionalAuthenticateToken, searchController.getAllUsersAndTeams);
router.get('/global', optionalAuthenticateToken, searchController.globalSearch);

// These routes require authentication
router.get('/', authenticateToken, searchController.search);
router.get('/by-tag/:tagId', authenticateToken, searchController.searchByTag);
router.get('/by-location', authenticateToken, searchController.searchByLocation);

module.exports = router;