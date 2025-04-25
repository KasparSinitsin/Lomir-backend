// Import necessary database configuration
const db = require('../config/database'); // Assuming 'db' might be used elsewhere or for other query methods
const { pool } = require('../config/database'); // Specifically importing pool for direct queries

/**
 * @description Get all users (Placeholder)
 * @route GET /api/users
 * @access Public (or Private depending on your auth setup)
 */
const getAllUsers = async (req, res) => {
  try {
    // Placeholder response - Implement actual logic later
    // Example: const result = await pool.query('SELECT id, username, email FROM users');
    res.status(200).json({
      success: true,
      message: 'Get all users placeholder',
      data: [] // Replace with result.rows when implemented
    });
  } catch (error) {
    console.error('Error fetching all users:', error); // Log the error
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message
    });
  }
};

/**
 * @description Get a single user by ID
 * @route GET /api/users/:id
 * @access Public (or Private)
 */
const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    // Use pool directly or stick to db.query if it's configured
    const result = await pool.query( // Using pool as per the update example
      'SELECT id, username, email, first_name, last_name, bio, avatar_url, postal_code, created_at FROM users WHERE id = $1',
      [userId]
    );

    // Check if user was found
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Send successful response
    res.status(200).json({
      success: true,
      message: 'User retrieved successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error(`Error fetching user ${req.params.id}:`, error); // Log the error
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
};

/**
 * @description Update a user's profile (DEBUGGING VERSION)
 * @route PUT /api/users/:id
 * @access Private (Requires authentication and authorization)
 */
const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    console.log('UPDATE USER CALLED FOR ID:', userId);
    console.log('REQUEST BODY:', req.body);

    // --- Debugging Direct Database Update ---
    // This version directly attempts to update the 'bio' field
    // It bypasses authorization checks and dynamic field updates for testing purposes.
    const result = await pool.query(
      'UPDATE users SET bio = $1, updated_at = NOW() WHERE id = $2 RETURNING *', // Added updated_at
      [req.body.bio || 'Updated bio via debug', userId] // Use provided bio or a default debug message
    );
    // --- End Debugging Section ---

    // Check if the update affected any rows (i.e., if the user ID exists)
    if (result.rows.length === 0) {
        // This case might happen if the ID doesn't exist.
        // The original code had this check after the query, which is correct.
        return res.status(404).json({
            success: false,
            message: 'User not found, update failed'
        });
    }

    console.log('Database update result:', result.rows[0]);

    // Send successful response with the updated user data
    res.status(200).json({
      success: true,
      message: 'User updated successfully (debug mode)',
      data: result.rows[0]
    });
  } catch (error) {
    // Log the detailed error
    console.error('Error updating user (debug mode):', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user (debug mode)',
      error: error.message
    });
  }
};


/**
 * @description Delete a user (Placeholder)
 * @route DELETE /api/users/:id
 * @access Private (Requires authentication and authorization)
 */
const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Placeholder - Implement actual delete logic later
    // Example:
    // Check authorization first (e.g., if req.user.id === userId || req.user.isAdmin)
    // await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.status(200).json({
      success: true,
      message: `Delete user ${userId} placeholder`,
      data: { id: userId }
    });
  } catch (error) {
    console.error(`Error deleting user ${req.params.id}:`, error); // Log the error
    res.status(500).json({
      success: false,
      message: 'Error deleting user',
      error: error.message
    });
  }
};

/**
 * @description Get teams associated with a user (Placeholder)
 * @route GET /api/users/:id/teams
 * @access Private (or Public depending on requirements)
 */
const getUserTeams = async (req, res) => {
  try {
    const userId = req.params.id;

    // Placeholder - Implement actual logic to fetch teams
    // Example: Join users and teams tables via a user_teams mapping table
    // const result = await pool.query('SELECT t.* FROM teams t JOIN user_teams ut ON t.id = ut.team_id WHERE ut.user_id = $1', [userId]);

    res.status(200).json({
      success: true,
      message: `Get teams for user ${userId} placeholder`,
      data: [] // Replace with result.rows when implemented
    });
  } catch (error) {
    console.error(`Error fetching teams for user ${req.params.id}:`, error); // Log the error
    res.status(500).json({
      success: false,
      message: 'Error fetching user teams',
      error: error.message
    });
  }
};

/**
 * @description Get tags associated with a user
 * @route GET /api/users/:id/tags
 * @access Private (or Public)
 */
const getUserTags = async (req, res) => {
  try {
    const userId = req.params.id;

    // Fetch tags associated with the user
    const tagsResult = await pool.query(`
      SELECT t.id, t.name, t.category, t.supercategory
      FROM tags t
      JOIN user_tags ut ON t.id = ut.tag_id
      WHERE ut.user_id = $1
    `, [userId]);

    // Send successful response
    res.status(200).json({
      success: true,
      data: tagsResult.rows
    });
  } catch (error) {
    console.error(`Error fetching tags for user ${req.params.id}:`, error); // Log the error
    res.status(500).json({
      success: false,
      message: 'Error fetching user tags',
      error: error.message
    });
  }
};

/**
 * @description Update the tags associated with a user
 * @route PUT /api/users/:id/tags
 * @access Private (Requires authentication)
 */
const updateUserTags = async (req, res) => {
  const userId = req.params.id;
  const { tags } = req.body; // Expecting an array like [{ tag_id: 1 }, { tag_id: 5 }]

  // Input validation: Ensure tags is an array
  if (!Array.isArray(tags)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid data provided: "tags" must be an array.'
    });
  }

  // Further validation: Ensure each item has a numeric tag_id (or adapt if IDs are UUIDs etc.)
  if (tags.some(tag => typeof tag.tag_id !== 'number' || !Number.isInteger(tag.tag_id))) {
      return res.status(400).json({
          success: false,
          message: 'Invalid tag data provided: Each tag must have a numeric "tag_id".'
      });
  }

  // Get a client from the pool for transaction management
  const client = await pool.connect();

  try {
    // Start transaction
    await client.query('BEGIN');

    // Clear existing tags for this user
    await client.query('DELETE FROM user_tags WHERE user_id = $1', [userId]);

    // Insert new tags if the array is not empty
    if (tags.length > 0) {
      // Prepare values for bulk insert or multiple inserts
      const insertPromises = tags.map(tag => {
        return client.query(
          'INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', // Added ON CONFLICT just in case
          [userId, tag.tag_id]
        );
      });
      // Wait for all insert operations to complete
      await Promise.all(insertPromises);
    }

    // Commit transaction
    await client.query('COMMIT');

    // Send success response
    res.status(200).json({
      success: true,
      message: 'User tags updated successfully'
    });
  } catch (error) {
    // Rollback transaction in case of error
    await client.query('ROLLBACK');
    console.error(`Error updating tags for user ${userId}:`, error); // Log the error
    res.status(500).json({
      success: false,
      message: 'Error updating user tags',
      error: error.message
    });
  } finally {
    // ALWAYS release the client back to the pool
    client.release();
  }
};

// Export all controller functions
module.exports = {
  getAllUsers,
  getUserById,
  updateUser, // Now using the debug version
  deleteUser,
  getUserTeams,
  getUserTags,
  updateUserTags
};
