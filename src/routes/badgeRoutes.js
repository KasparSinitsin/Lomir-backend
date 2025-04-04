const express = require('express');
const badgeController = require('../controllers/badgeController');
const { authenticateToken } = require('../middlewares/auth');

const router = express.Router();

router.get('/', badgeController.getAllBadges);
router.post('/award', authenticateToken, badgeController.awardBadge);
router.get('/user/:userId', badgeController.getUserBadges);

module.exports = router;