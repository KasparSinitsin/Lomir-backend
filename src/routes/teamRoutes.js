const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const auth = require('../middlewares/auth');

// Team routes
router.post('/api', auth.authenticateToken, teamController.createTeam);
router.get('/api', teamController.getAllTeams);
router.get('/api/teams/my-teams', auth.authenticateToken, teamController.getUserTeams);
router.get('/api/:id', teamController.getTeamById);
router.put('/api/:id', auth.authenticateToken, teamController.updateTeam);
router.delete('/api/:id', auth.authenticateToken, teamController.deleteTeam);
router.post('/api/:id/members', auth.authenticateToken, teamController.addTeamMember);
router.delete('/api/:id/members/:userId', auth.authenticateToken, teamController.removeTeamMember);
router.get('/api/:id/members/:userId/role', auth.authenticateToken, teamController.getUserRoleInTeam);

module.exports = router;