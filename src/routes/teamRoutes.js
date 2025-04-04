const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const auth = require('../middlewares/auth'); // assuming you want team actions protected

// Team routes
router.post('/', auth, teamController.createTeam); // protect team creation
router.get('/', teamController.getAllTeams);
router.get('/:id', teamController.getTeamById);
router.put('/:id', auth, teamController.updateTeam); // protect updates
router.delete('/:id', auth, teamController.deleteTeam); // protect deletions
router.post('/:id/members', auth, teamController.addTeamMember);
router.delete('/:id/members/:userId', auth, teamController.removeTeamMember);

module.exports = router;
