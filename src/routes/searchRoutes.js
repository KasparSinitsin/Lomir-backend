const express = require('express');
const searchController = require('../controllers/searchController');
const { authenticateToken } = require('../middlewares/auth');

const router = express.Router();

router.get('/', searchController.globalSearch); //Public

router.get('/', authenticateToken, searchController.search); //Protected
router.get('/by-tag/:tagId', authenticateToken, searchController.searchByTag); //Protected
router.get('/by-location', authenticateToken, searchController.searchByLocation); //Protected

module.exports = router;