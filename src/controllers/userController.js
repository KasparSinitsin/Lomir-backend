const db = require("../config/database");
const { pool } = db;
const cloudinary = require("../config/cloudinary");

// Helper function to extract Cloudinary public ID from URL
const extractCloudinaryPublicId = (url) => {
  if (!url || typeof url !== "string") return null;

  // Match Cloudinary URL pattern and extract public ID
  const match = url.match(/\/image\/upload\/(?:v\d+\/)?(.+)\.[a-z]+$/);
  return match ? match[1] : null;
};

/**
 * @description Get all users (Placeholder)
 * @route GET /api/users
 * @access Public (or Private depending on your auth setup)
 */
const getAllUsers = async (req, res) => {
  try {
    // Placeholder response - Implement actual logic to fetch all users later
    console.log("getAllUsers placeholder called.");
    res.status(200).json({
      success: true,
      message: "Get all users placeholder",
      data: [], // Replace with result.rows when implemented
    });
  } catch (error) {
    console.error("Error fetching all users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching users",
      error: error.message,
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
    console.log(`getUserById called for ID: ${userId}`);

    // Use pool directly for the query - Updated to include tags as a string (consistent with search)
    const result = await pool.query(
      `SELECT 
         u.id, u.username, u.email, u.first_name, u.last_name, 
         u.bio, u.avatar_url, u.postal_code, u.is_public, u.created_at,
         (SELECT STRING_AGG(t.name, ', ')
          FROM user_tags ut
          JOIN tags t ON ut.tag_id = t.id
          WHERE ut.user_id = u.id) as tags
       FROM users u
       WHERE u.id = $1`,
      [userId]
    );

    // Check if user was found
    if (result.rows.length === 0) {
      console.log(`User not found for ID: ${userId}`);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];
    console.log(`User found for ID: ${userId}`, user);

    // Send successful response with user data including tags as string
    res.status(200).json({
      success: true,
      message: "User retrieved successfully",
      // Data is already snake_case from DB, frontend interceptor handles conversion
      data: user,
    });
  } catch (error) {
    console.error(`Error fetching user ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error fetching user",
      error: error.message,
    });
  }
};

/**
 * @description Update a user's profile
 * @route PUT /api/users/:id
 * @access Private (Requires authentication and authorization)
 */
const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    console.log("updateUser called for ID:", userId);
    console.log("Request body:", req.body);

    // First, get the current user data to access the old avatar URL
    const currentUserResult = await pool.query(
      "SELECT avatar_url FROM users WHERE id = $1",
      [userId]
    );

    if (currentUserResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentUser = currentUserResult.rows[0];
    const oldAvatarUrl = currentUser.avatar_url;

    // Extract all relevant fields from request body
    const {
      first_name,
      last_name,
      email,
      bio,
      postal_code,
      avatar_url,
      is_public,
    } = req.body;

    // Build SET clause dynamically
    const updateFields = [];
    const queryParams = [];
    let paramPosition = 1;

    // Add fields that exist in the request
    if (first_name !== undefined) {
      updateFields.push(`first_name = $${paramPosition}`);
      queryParams.push(first_name);
      paramPosition++;
    }
    if (last_name !== undefined) {
      updateFields.push(`last_name = $${paramPosition}`);
      queryParams.push(last_name);
      paramPosition++;
    }
    if (email !== undefined) {
      // Check if email is already taken by another user
      const emailCheck = await pool.query(
        "SELECT id FROM users WHERE email = $1 AND id != $2",
        [email, userId]
      );

      if (emailCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Email already in use by another account",
        });
      }

      updateFields.push(`email = $${paramPosition}`);
      queryParams.push(email);
      paramPosition++;
    }

    if (bio !== undefined) {
      updateFields.push(`bio = $${paramPosition}`);
      queryParams.push(bio);
      paramPosition++;
    }
    if (postal_code !== undefined) {
      updateFields.push(`postal_code = $${paramPosition}`);
      queryParams.push(postal_code);
      paramPosition++;
    }

    // Handle avatar URL update with old image deletion
    if (avatar_url !== undefined) {
      updateFields.push(`avatar_url = $${paramPosition}`);
      queryParams.push(avatar_url);
      paramPosition++;

      // Delete old image from Cloudinary if it exists and is different from new one
      if (
        oldAvatarUrl &&
        oldAvatarUrl !== avatar_url &&
        oldAvatarUrl.includes("cloudinary.com")
      ) {
        try {
          const publicId = extractCloudinaryPublicId(oldAvatarUrl);
          if (publicId) {
            console.log(
              `Attempting to delete old avatar from Cloudinary: ${publicId}`
            );
            const deleteResult = await cloudinary.uploader.destroy(publicId);
            console.log("Cloudinary deletion result:", deleteResult);
          }
        } catch (cloudinaryError) {
          console.error(
            "Error deleting old avatar from Cloudinary:",
            cloudinaryError
          );
          // Don't fail the update if Cloudinary deletion fails
        }
      }
    }

    // Make sure is_public is explicitly handled
    if (is_public !== undefined) {
      updateFields.push(`is_public = $${paramPosition}`);
      queryParams.push(is_public);
      paramPosition++;
      console.log(`Setting is_public to: ${is_public} (${typeof is_public})`);
    }

    // Always update the updated_at timestamp
    updateFields.push(`updated_at = NOW()`);

    // Only proceed if there are fields to update
    if (updateFields.length === 1) {
      // Only updated_at is in the array
      return res.status(400).json({
        success: false,
        message: "No fields provided for update",
      });
    }

    // Add the user ID as the last parameter
    queryParams.push(userId);

    // Build and execute the query
    const query = `
      UPDATE users 
      SET ${updateFields.join(", ")} 
      WHERE id = $${paramPosition}
      RETURNING id, username, email, first_name, last_name, bio, avatar_url, postal_code, is_public, created_at, updated_at
    `;

    console.log("Executing query:", query);
    console.log("With parameters:", queryParams);

    const result = await pool.query(query, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Log the response data before sending it
    console.log("Response data being sent to client:", result.rows[0]);

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error(`Error updating user ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error updating user",
      error: error.message,
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
    console.log(`deleteUser placeholder called for ID: ${userId}`);

    // Placeholder - Implement actual delete logic later
    res.status(200).json({
      success: true,
      message: `Delete user ${userId} placeholder`,
      data: { id: userId }, // Return the ID of the "deleted" user
    });
  } catch (error) {
    console.error(`Error deleting user ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error deleting user",
      error: error.message,
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
    console.log(`getUserTeams placeholder called for user ID: ${userId}`);

    // Placeholder - Implement actual logic to fetch teams
    res.status(200).json({
      success: true,
      message: `Get teams for user ${userId} placeholder`,
      data: [], // Replace with result.rows when implemented
    });
  } catch (error) {
    console.error(`Error fetching teams for user ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error fetching user teams",
      error: error.message,
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
    console.log(`getUserTags called for user ID: ${userId}`);

    // Fetch tags associated with the user using a JOIN
    const tagsResult = await pool.query(
      `
      SELECT t.id, t.name, t.category, t.supercategory
      FROM tags t
      JOIN user_tags ut ON t.id = ut.tag_id
      WHERE ut.user_id = $1
    `,
      [userId]
    );

    console.log(`Found ${tagsResult.rows.length} tags for user ID: ${userId}`);

    // Send successful response with the list of tags
    res.status(200).json({
      success: true,
      // data is already snake_case from DB
      data: tagsResult.rows,
    });
  } catch (error) {
    console.error(`Error fetching tags for user ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error fetching user tags",
      error: error.message,
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
  console.log(`updateUserTags called for user ID: ${userId} with tags:`, tags);

  // --- Input Validation ---
  // Ensure tags is an array
  if (!Array.isArray(tags)) {
    console.log(`updateUserTags validation failed: tags is not an array.`);
    return res.status(400).json({
      success: false,
      message: 'Invalid data provided: "tags" must be an array.',
    });
  }

  // Ensure each item in the array is an object with a numeric 'tag_id'
  // Adapting check for snake_case `tag_id` from request body
  if (
    tags.some(
      (tag) =>
        typeof tag !== "object" ||
        typeof tag.tag_id !== "number" ||
        !Number.isInteger(tag.tag_id)
    )
  ) {
    console.log(
      `updateUserTags validation failed: invalid tag structure or non-integer tag_id found.`
    );
    return res.status(400).json({
      success: false,
      message:
        'Invalid tag data provided: Each item in "tags" must be an object with a numeric "tag_id".',
    });
  }
  // --- End Validation ---

  // Get a client from the pool for transaction management
  const client = await pool.connect();
  console.log(`Transaction started for updating tags for user ID: ${userId}`);

  try {
    // Start transaction
    await client.query("BEGIN");

    // Clear existing tags for this user first
    const deleteResult = await client.query(
      "DELETE FROM user_tags WHERE user_id = $1",
      [userId]
    );
    console.log(
      `Deleted ${deleteResult.rowCount} existing tags for user ID: ${userId}`
    );

    // Insert new tags if the tags array is not empty
    if (tags.length > 0) {
      // Use Promise.all to run inserts concurrently for potentially better performance
      const insertPromises = tags.map((tag) => {
        console.log(`Inserting tag_id: ${tag.tag_id} for user ID: ${userId}`);
        return client.query(
          // Insert user-tag relationship. ON CONFLICT DO NOTHING handles potential duplicate tag_ids in input.
          "INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2) ON CONFLICT (user_id, tag_id) DO NOTHING",
          [userId, tag.tag_id]
        );
      });
      // Wait for all insert operations to complete
      await Promise.all(insertPromises);
      console.log(
        `Finished inserting ${tags.length} new tags for user ID: ${userId}`
      );
    } else {
      console.log(
        `No new tags provided for user ID: ${userId}, only deletion performed.`
      );
    }

    // Commit the transaction if all operations were successful
    await client.query("COMMIT");
    console.log(`Transaction committed successfully for user ID: ${userId}`);

    // Send success response
    res.status(200).json({
      success: true,
      message: "User tags updated successfully",
    });
  } catch (error) {
    // If any error occurs, rollback the transaction
    await client.query("ROLLBACK");
    console.error(
      `Error updating tags for user ${userId}, transaction rolled back:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Error updating user tags",
      error: error.message,
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
  updateUser,
  deleteUser,
  getUserTeams,
  getUserTags,
  updateUserTags,
};
