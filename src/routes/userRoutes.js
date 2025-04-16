const express = require('express');
const userController = require('../controllers/userController');
const auth = require('../middlewares/auth');

const router = express.Router();

// Routes for getting and updating users
router.get('/api', userController.getAllUsers);  // Get all users
router.get('/api/:id', userController.getUserById);  // Get user by ID
router.put('/api/:id', auth.authenticateToken, userController.updateUser);  // Update user by ID
router.delete('/api/:id', auth.authenticateToken, userController.deleteUser);  // Delete user by ID

// Routes for getting user teams
router.get('/api/teams/my-teams');

router.get('/api/:id/tags', userController.getUserTags);  // Get tags for a user by ID
router.put('/api/:id/tags', auth.authenticateToken, userController.updateUserTags);  // Update tags for a user by ID

module.exports = router;