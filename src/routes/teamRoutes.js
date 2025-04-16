const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const auth = require('../middlewares/auth');

// Team routes
router.post('/', auth.authenticateToken, teamController.createTeam); 
router.get('/', teamController.getAllTeams);  
router.get('/my-teams', auth.authenticateToken, teamController.getUserTeams);  
router.get('/:id', teamController.getTeamById);  
router.put('/:id', auth.authenticateToken, teamController.updateTeam); 
router.delete('/:id', auth.authenticateToken, teamController.deleteTeam); 
router.post('/:id/members', auth.authenticateToken, teamController.addTeamMember);  
router.delete('/:id/members/:userId', auth.authenticateToken, teamController.removeTeamMember);  
router.get('/:id/members/:userId/role', auth.authenticateToken, teamController.getUserRoleInTeam); 

module.exports = router;