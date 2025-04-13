const express = require('express');
const { globalSearch, getRecommended, searchByTag, searchByLocation } = require('../controllers/searchController');
const { authenticateToken } = require('../middlewares/auth');

const router = express.Router();

// Route for public global search
router.get('/global', globalSearch);

// Route for protected search by tag (authenticated users only)
router.get('/by-tag/:tagId', authenticateToken, searchByTag);

// Route for protected search by location (authenticated users only)
router.get('/by-location', authenticateToken, searchByLocation);

// Route for getting recommended teams/users based on shared tags
router.get('/recommended', authenticateToken, getRecommended);

module.exports = router;