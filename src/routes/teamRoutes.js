const express = require('express');
const teamController = require('../controllers/teamController');

const router = express.Router();

router.post('/', teamController.createTeam);
router.get('/', teamController.getAllTeams);
router.get('/:id', teamController.getTeamById);
router.put('/:id', teamController.updateTeam);
router.delete('/:id', teamController.deleteTeam);
router.post('/:id/members', teamController.addTeamMember);
router.delete('/:id/members/:userId', teamController.removeTeamMember);

module.exports = router;