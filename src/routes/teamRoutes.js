const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const auth = require('../middlewares/auth');

// Team routes
router.post('/', auth.authenticateToken, teamController.createTeam);
router.get('/', teamController.getAllTeams);
router.get('/:id', teamController.getTeamById);
router.put('/:id', auth.authenticateToken, teamController.updateTeam); // Fixed
router.delete('/:id', auth.authenticateToken, teamController.deleteTeam); // Fixed
router.post('/:id/members', auth.authenticateToken, teamController.addTeamMember); // Fixed
router.delete('/:id/members/:userId', auth.authenticateToken, teamController.removeTeamMember); // Fixed

module.exports = router;