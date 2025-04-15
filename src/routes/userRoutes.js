const express = require('express');
const userController = require('../controllers/userController');
const auth = require('../middlewares/auth');

const router = express.Router();

router.get('/', userController.getAllUsers);
router.get('/:id', userController.getUserById);
router.put('/:id', auth.authenticateToken, userController.updateUser); // Protected
router.delete('/:id', auth.authenticateToken, userController.deleteUser); // Protected
router.get('/:id/teams', userController.getUserTeams);

module.exports = router;