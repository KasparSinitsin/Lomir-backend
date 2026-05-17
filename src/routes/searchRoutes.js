const express = require('express');
const searchController = require('../controllers/searchController');
const { optionalAuthenticateToken } = require('../middlewares/auth');

const router = express.Router();

// Use optional authentication for routes that can work with or without authentication
router.get('/all', optionalAuthenticateToken, searchController.getAllUsersAndTeams);
router.get('/global', optionalAuthenticateToken, searchController.globalSearch);

module.exports = router;
