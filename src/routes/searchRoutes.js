const express = require('express');
const searchController = require('../controllers/searchController');
const { authenticateToken } = require('../middlewares/auth');

const router = express.Router();

router.get('/global', searchController.globalSearch); // Public global search
router.get('/', authenticateToken, searchController.search); // Protected general search
router.get('/by-tag/:tagId', authenticateToken, searchController.searchByTag); // Protected tag search
router.get('/by-location', authenticateToken, searchController.searchByLocation); // Protected location search

module.exports = router;