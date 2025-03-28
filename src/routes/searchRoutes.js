const express = require('express');
const searchController = require('../controllers/searchController');

const router = express.Router();

router.get('/', searchController.search);
router.get('/by-tag/:tagId', searchController.searchByTag);
router.get('/by-location', searchController.searchByLocation);

module.exports = router;