const express = require('express');
const userController = require('../controllers/userController');
// Import your authentication middleware
const auth = require('../middlewares/auth'); // Assuming '../middlewares/auth' is the correct path

const router = express.Router();

// === Core User Routes ===

// GET /api/users - Get all users (Placeholder in controller)
// Access: Public (or add auth.authenticateToken if needed)
router.get('/', userController.getAllUsers);

// GET /api/users/:id - Get a specific user by their ID
// Access: Public (or add auth.authenticateToken if needed)
router.get('/:id', userController.getUserById);

// PUT /api/users/:id - Update a specific user by their ID
// Access: Private (Requires valid token)
// Note: Currently points to the DEBUG version in userController
router.put('/:id', auth.authenticateToken, userController.updateUser);

// DELETE /api/users/:id - Delete a specific user by their ID (Placeholder in controller)
// Access: Private (Requires valid token)
router.delete('/:id', auth.authenticateToken, userController.deleteUser);


// === User-Specific Sub-Resources ===

// GET /api/users/:id/teams - Get teams associated with a specific user (Placeholder in controller)
// Access: Private (Requires valid token - added assumption, adjust if needed)
// *** CORRECTED: Added /:id parameter to specify the user ***
router.get('/:id/teams', auth.authenticateToken, userController.getUserTeams);


// GET /api/users/:id/tags - Get tags associated with a specific user
// Access: Public (as written - add auth.authenticateToken if it should be private)
// *** This route definition looks correct, matching the frontend call ***
router.get('/:id/tags', userController.getUserTags);

// PUT /api/users/:id/tags - Update tags associated with a specific user
// Access: Private (Requires valid token)
router.put('/:id/tags', auth.authenticateToken, userController.updateUserTags);


// Export the router for use in app.js
module.exports = router;
