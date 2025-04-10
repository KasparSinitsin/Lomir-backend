const express = require('express');
const searchController = require('../controllers/searchController');
const { authenticateToken } = require('../middlewares/auth');

const router = express.Router();

// Global search - no authentication required
router.get('/', searchController.globalSearch);

// Tag-based search - optional authentication
router.get('/by-tag/:tagId', searchController.searchByTag);

// Location-based search - requires authentication
router.get('/by-location', authenticateToken, searchController.searchByLocation);

module.exports = router;