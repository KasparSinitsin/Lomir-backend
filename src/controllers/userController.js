// Import necessary database configuration
// Assuming 'db' might be used elsewhere or provides alternative query methods
const db = require('../config/database');
// Specifically importing pool for direct query execution as per debug instructions
const { pool } = require('../config/database');

/**
 * @description Get all users (Placeholder)
 * @route GET /api/users
 * @access Public (or Private depending on your auth setup)
 */
const getAllUsers = async (req, res) => {
  try {
    // Placeholder response - Implement actual logic to fetch all users later
    // Example: const result = await pool.query('SELECT id, username, email FROM users');
    console.log('getAllUsers placeholder called.'); // Added log
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
    console.log(`getUserById called for ID: ${userId}`); // Added log

    // Use pool directly for the query
    const result = await pool.query(
      'SELECT id, username, email, first_name, last_name, bio, avatar_url, postal_code, created_at FROM users WHERE id = $1',
      [userId]
    );

    // Check if user was found
    if (result.rows.length === 0) {
      console.log(`User not found for ID: ${userId}`); // Added log
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Send successful response with user data
    console.log(`User found for ID: ${userId}`); // Added log
    res.status(200).json({
      success: true,
      message: 'User retrieved successfully',
      // Data is already snake_case from DB, frontend interceptor handles conversion
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
 * @description Update a user's profile (DEBUGGING VERSION - Step 8)
 * @route PUT /api/users/:id
 * @access Private (Requires authentication and authorization - bypassed in this debug version)
 */
const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    // Log incoming request details for debugging
    console.log('DEBUG updateUser CALLED FOR ID:', userId);
    // Log the raw request body (should be snake_case if frontend interceptor works)
    console.log('DEBUG REQUEST BODY:', req.body);

    // --- Debugging Direct Database Update ---
    // Directly updates 'bio' and 'updated_at' using pool.query.
    // Bypasses dynamic field building and authorization checks for testing.
    const bioToUpdate = req.body.bio || `Updated bio via debug at ${new Date().toISOString()}`; // Use provided bio or a default debug message
    console.log(`Attempting direct DB update for user ${userId} with bio: "${bioToUpdate}"`); // Log intent

    const result = await pool.query(
      // Update the user's bio and set the updated_at timestamp
      // RETURNING * fetches all columns of the updated row
      'UPDATE users SET bio = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [bioToUpdate, userId]
    );
    // --- End Debugging Section ---

    // Check if the update query actually found and updated a row
    if (result.rows.length === 0) {
        // This means the WHERE id = $2 clause did not match any user
        console.log(`DEBUG updateUser: User not found for ID ${userId}, update failed.`);
        return res.status(404).json({
            success: false,
            message: 'User not found, update failed'
        });
    }

    // Log the result of the database operation
    console.log('DEBUG Database update result (user data):', result.rows[0]);

    // Send successful response with the updated user data
    res.status(200).json({
      success: true,
      message: 'User updated successfully (debug mode)',
      // Return the updated user data (already snake_case)
      data: result.rows[0]
    });
  } catch (error) {
    // Log any errors encountered during the process
    console.error(`Error updating user ${req.params.id} (debug mode):`, error);
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
    console.log(`deleteUser placeholder called for ID: ${userId}`); // Added log

    // Placeholder - Implement actual delete logic later
    // Example:
    // 1. Check authorization (e.g., if req.user.id === userId || req.user.isAdmin)
    // 2. Perform delete: await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    // 3. Check result.rowCount to confirm deletion

    res.status(200).json({
      success: true,
      message: `Delete user ${userId} placeholder`,
      data: { id: userId } // Return the ID of the "deleted" user
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
    console.log(`getUserTeams placeholder called for user ID: ${userId}`); // Added log

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
    console.log(`getUserTags called for user ID: ${userId}`); // Added log

    // Fetch tags associated with the user using a JOIN
    const tagsResult = await pool.query(`
      SELECT t.id, t.name, t.category, t.supercategory
      FROM tags t
      JOIN user_tags ut ON t.id = ut.tag_id
      WHERE ut.user_id = $1
    `, [userId]);

    console.log(`Found ${tagsResult.rows.length} tags for user ID: ${userId}`); // Added log

    // Send successful response with the list of tags
    res.status(200).json({
      success: true,
      // data is already snake_case from DB
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
  // Expecting body like { tags: [{ tag_id: 1 }, { tag_id: 5 }] } (snake_case from frontend interceptor)
  const { tags } = req.body;
  console.log(`updateUserTags called for user ID: ${userId} with tags:`, tags); // Added log

  // --- Input Validation ---
  // Ensure tags is an array
  if (!Array.isArray(tags)) {
    console.log(`updateUserTags validation failed: tags is not an array.`);
    return res.status(400).json({
      success: false,
      message: 'Invalid data provided: "tags" must be an array.'
    });
  }

  // Ensure each item in the array is an object with a numeric 'tag_id'
  // Adapting check for snake_case `tag_id` from request body
  if (tags.some(tag => typeof tag !== 'object' || typeof tag.tag_id !== 'number' || !Number.isInteger(tag.tag_id))) {
      console.log(`updateUserTags validation failed: invalid tag structure or non-integer tag_id found.`);
      return res.status(400).json({
          success: false,
          message: 'Invalid tag data provided: Each item in "tags" must be an object with a numeric "tag_id".'
      });
  }
  // --- End Validation ---


  // Get a client from the pool for transaction management
  const client = await pool.connect();
  console.log(`Transaction started for updating tags for user ID: ${userId}`);

  try {
    // Start transaction
    await client.query('BEGIN');

    // Clear existing tags for this user first
    const deleteResult = await client.query('DELETE FROM user_tags WHERE user_id = $1', [userId]);
    console.log(`Deleted ${deleteResult.rowCount} existing tags for user ID: ${userId}`);

    // Insert new tags if the tags array is not empty
    if (tags.length > 0) {
      // Use Promise.all to run inserts concurrently for potentially better performance
      const insertPromises = tags.map(tag => {
        console.log(`Inserting tag_id: ${tag.tag_id} for user ID: ${userId}`);
        return client.query(
          // Insert user-tag relationship. ON CONFLICT DO NOTHING handles potential duplicate tag_ids in input.
          'INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2) ON CONFLICT (user_id, tag_id) DO NOTHING',
          [userId, tag.tag_id]
        );
      });
      // Wait for all insert operations to complete
      await Promise.all(insertPromises);
      console.log(`Finished inserting ${tags.length} new tags for user ID: ${userId}`);
    } else {
      console.log(`No new tags provided for user ID: ${userId}, only deletion performed.`);
    }

    // Commit the transaction if all operations were successful
    await client.query('COMMIT');
    console.log(`Transaction committed successfully for user ID: ${userId}`);

    // Send success response
    res.status(200).json({
      success: true,
      message: 'User tags updated successfully'
    });
  } catch (error) {
    // If any error occurs, rollback the transaction
    await client.query('ROLLBACK');
    console.error(`Error updating tags for user ${userId}, transaction rolled back:`, error); // Log the error
    res.status(500).json({
      success: false,
      message: 'Error updating user tags',
      error: error.message
    });
  } finally {
    // ALWAYS release the client back to the pool in the finally block
    client.release();
    console.log(`Database client released for user ID: ${userId} tag update.`);
  }
};

// Export all controller functions for use in the user routes file
module.exports = {
  getAllUsers,
  getUserById,
  updateUser, // Exporting the debug version
  deleteUser,
  getUserTeams,
  getUserTags,
  updateUserTags
};
