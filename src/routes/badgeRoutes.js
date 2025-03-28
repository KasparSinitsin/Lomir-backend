const express = require('express');
const badgeController = require('../controllers/badgeController');

const router = express.Router();

router.get('/', badgeController.getAllBadges);
router.post('/award', badgeController.awardBadge);
router.get('/user/:userId', badgeController.getUserBadges);

module.exports = router;