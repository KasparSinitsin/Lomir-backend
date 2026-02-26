const { pool } = require("../config/database");
const cloudinary = require("cloudinary").v2;
const {
  geocodeAddress,
  hasLocationChanged,
} = require("../utils/geocodingUtil");

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Helper function to extract Cloudinary public ID from URL
const extractCloudinaryPublicId = (url) => {
  try {
    // URL format: https://res.cloudinary.com/cloud_name/image/upload/v1234567890/folder/public_id.ext
    const urlParts = url.split("/");
    const uploadIndex = urlParts.indexOf("upload");
    if (uploadIndex === -1) return null;

    // Get everything after 'upload' and version number
    const pathAfterUpload = urlParts.slice(uploadIndex + 2).join("/");
    // Remove file extension
    const publicId = pathAfterUpload.replace(/\.[^/.]+$/, "");
    return publicId;
  } catch (error) {
    console.error("Error extracting Cloudinary public ID:", error);
    return null;
  }
};

/**
 * @description Get all users
 * @route GET /api/users
 * @access Private
 */
const getUsers = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users");
    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
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
 * @access Private
 */
const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    console.log(`Fetching user with ID: ${userId}`);

    // Fetch user with tags as a comma-separated string
    const result = await pool.query(
      `
  SELECT 
    u.id,
    u.username,
    u.email,
    u.first_name,
    u.last_name,
    u.bio,
    u.postal_code,
    u.city,
    u.country,
    u.state,
    u.latitude,
    u.longitude,
    u.avatar_url,
    u.is_public,
    u.created_at,
    u.updated_at,
    COALESCE((
      SELECT total_badge_credits
      FROM v_user_total_badge_credits
      WHERE user_id = u.id
    ), 0) AS total_badge_credits,

    (
      SELECT STRING_AGG(t.name, ', ')
      FROM user_tags ut
      JOIN tags t ON ut.tag_id = t.id
      WHERE ut.user_id = u.id
    ) as tags,
       (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'id', v.badge_id,
            'name', v.badge_name,
            'category', v.category,
            'color', v.badge_color,
            'cat_image_url', v.cat_image_url,
            'total_credits', v.total_credits,
            'award_count', v.award_count,
            'awarder_count', v.awarder_count,
            'category_total_credits', v.category_total_credits,
            'category_award_count', v.category_award_count,
            'category_awarder_count', v.category_awarder_count,
            'last_awarded_at', v.last_awarded_at
          )
          ORDER BY
            v.category_total_credits DESC,
            v.category ASC,
            v.total_credits DESC,
            v.badge_name ASC
        ),
        '[]'::json
      )
      FROM v_user_badges_with_category_totals v
      WHERE v.user_id = u.id
    ) as badges

  FROM users u
  WHERE u.id = $1
`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    // Log the retrieved user data for debugging
    console.log("Retrieved user from database:", {
      id: user.id,
      username: user.username,
      is_public: user.is_public,
      city: user.city,
      country: user.country,
      tags: user.tags,
    });

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

    // First, get the current user data to access the old avatar URL and location
    const currentUserResult = await pool.query(
      "SELECT avatar_url, postal_code, city, country, state, latitude, longitude FROM users WHERE id = $1",
      [userId],
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
      username,
      email,
      bio,
      postal_code,
      city,
      country,
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
    if (username !== undefined) {
      // Check if username is already taken by another user
      const usernameCheck = await pool.query(
        "SELECT id FROM users WHERE username = $1 AND id != $2",
        [username, userId],
      );

      if (usernameCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Username already in use by another account",
        });
      }

      updateFields.push(`username = $${paramPosition}`);
      queryParams.push(username);
      paramPosition++;
    }
    if (email !== undefined) {
      // Check if email is already taken by another user
      const emailCheck = await pool.query(
        "SELECT id FROM users WHERE email = $1 AND id != $2",
        [email, userId],
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
    if (city !== undefined) {
      updateFields.push(`city = $${paramPosition}`);
      queryParams.push(city);
      paramPosition++;
    }
    if (country !== undefined) {
      updateFields.push(`country = $${paramPosition}`);
      queryParams.push(country);
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
              `Attempting to delete old avatar from Cloudinary: ${publicId}`,
            );
            const deleteResult = await cloudinary.uploader.destroy(publicId);
            console.log("Cloudinary deletion result:", deleteResult);
          }
        } catch (cloudinaryError) {
          console.error(
            "Error deleting old avatar from Cloudinary:",
            cloudinaryError,
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

    // Check if location data has changed and trigger geocoding
    const newLocationData = {
      postal_code:
        postal_code !== undefined ? postal_code : currentUser.postal_code,
      city: city !== undefined ? city : currentUser.city,
      country: country !== undefined ? country : currentUser.country,
    };

    const locationChanged = hasLocationChanged(newLocationData, currentUser);

    if (locationChanged) {
      console.log("Location data changed, triggering geocoding...");
      const coordinates = await geocodeAddress(newLocationData);

      if (coordinates) {
        console.log(
          `Geocoded new coordinates: lat=${coordinates.latitude}, lng=${coordinates.longitude}`,
        );
        updateFields.push(`latitude = $${paramPosition}`);
        queryParams.push(coordinates.latitude);
        paramPosition++;

        updateFields.push(`longitude = $${paramPosition}`);
        queryParams.push(coordinates.longitude);
        paramPosition++;

        updateFields.push(`state = $${paramPosition}`);
        queryParams.push(coordinates.state);
        paramPosition++;
      } else {
        console.log(
          "Geocoding failed or returned no results, clearing coordinates",
        );
        // Clear coordinates if geocoding fails
        updateFields.push(`latitude = $${paramPosition}`);
        queryParams.push(null);
        paramPosition++;

        updateFields.push(`longitude = $${paramPosition}`);
        queryParams.push(null);
        paramPosition++;

        updateFields.push(`state = $${paramPosition}`);
        queryParams.push(null);
        paramPosition++;
      }
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
      RETURNING id, username, email, first_name, last_name, bio, postal_code, city, country, state, latitude, longitude, avatar_url, is_public, created_at, updated_at
    `;

    console.log("Executing update query:", query);
    console.log("With params:", queryParams);

    const result = await pool.query(query, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log("Update successful:", result.rows[0]);

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({
      success: false,
      message: "Error updating user",
      error: error.message,
    });
  }
};

/**
 * @description Delete user's avatar
 * @route DELETE /api/users/:id/avatar
 * @access Private
 */
const deleteAvatar = async (req, res) => {
  try {
    const userId = req.params.id;

    // Verify the user making the request is the same as the user being updated
    if (req.user.id !== parseInt(userId)) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own avatar",
      });
    }

    // Get the current avatar URL
    const userResult = await pool.query(
      "SELECT avatar_url FROM users WHERE id = $1",
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentAvatarUrl = userResult.rows[0].avatar_url;

    // Delete from Cloudinary if it exists
    if (currentAvatarUrl && currentAvatarUrl.includes("cloudinary.com")) {
      try {
        const publicId = extractCloudinaryPublicId(currentAvatarUrl);
        if (publicId) {
          console.log(`Deleting avatar from Cloudinary: ${publicId}`);
          await cloudinary.uploader.destroy(publicId);
        }
      } catch (cloudinaryError) {
        console.error(
          "Error deleting avatar from Cloudinary:",
          cloudinaryError,
        );
        // Continue anyway to clear the database reference
      }
    }

    // Clear the avatar_url in the database
    await pool.query(
      "UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1",
      [userId],
    );

    res.status(200).json({
      success: true,
      message: "Avatar deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting avatar:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting avatar",
      error: error.message,
    });
  }
};

/**
 * @description Delete a user's account
 * @route DELETE /api/users/:id
 * @access Private (Requires authentication and authorization)
 */
const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Verify the user making the request is the same as the user being deleted
    if (req.user.id !== parseInt(userId)) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own account",
      });
    }

    // Get the user's avatar URL before deletion
    const userResult = await pool.query(
      "SELECT avatar_url FROM users WHERE id = $1",
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const avatarUrl = userResult.rows[0].avatar_url;

    // Delete from Cloudinary if avatar exists
    if (avatarUrl && avatarUrl.includes("cloudinary.com")) {
      try {
        const publicId = extractCloudinaryPublicId(avatarUrl);
        if (publicId) {
          await cloudinary.uploader.destroy(publicId);
        }
      } catch (cloudinaryError) {
        console.error(
          "Error deleting avatar from Cloudinary:",
          cloudinaryError,
        );
      }
    }

    // Delete the user (cascade will handle related records)
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);

    res.status(200).json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting user",
      error: error.message,
    });
  }
};

/**
 * @description Get tags for a specific user
 * @route GET /api/users/:id/tags
 * @access Public
 */
const getUserTags = async (req, res) => {
  try {
    const userId = req.params.id;

    const result = await pool.query(
      `
      SELECT 
  t.id,
  t.name,
  t.category,
  t.supercategory,
  ut.experience_level,
  ut.interest_level,
  ut.badge_credits,
  ut.dominant_badge_category,
  (SELECT COUNT(*) FROM badge_awards ba WHERE ba.tag_id = t.id AND ba.awarded_to_user_id = ut.user_id) AS linked_badge_count,
  (SELECT COUNT(DISTINCT ba.awarded_by_user_id) FROM badge_awards ba WHERE ba.tag_id = t.id AND ba.awarded_to_user_id = ut.user_id) AS awarder_count
FROM user_tags ut
JOIN tags t ON ut.tag_id = t.id
WHERE ut.user_id = $1
    `,
      [userId],
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching user tags:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user tags",
      error: error.message,
    });
  }
};

/**
 * @description Update tags for a specific user
 * @route PUT /api/users/:id/tags
 * @access Private
 */
const updateUserTags = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.params.id;
    const { tags } = req.body;

    // Verify the user making the request is the same as the user being updated
    if (req.user.id !== parseInt(userId)) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own tags",
      });
    }

    await client.query("BEGIN");

    // Calculate badge credits from badge_awards (source of truth)
    // This works for both preserved AND re-added tags
    const badgeCreditData = await client.query(
      `SELECT
         tag_id,
         SUM(credits) AS badge_credits
       FROM badge_awards
       WHERE awarded_to_user_id = $1 AND tag_id IS NOT NULL
       GROUP BY tag_id`,
      [userId],
    );
    const creditMap = {};
    for (const row of badgeCreditData.rows) {
      creditMap[row.tag_id] = { badge_credits: Number(row.badge_credits) };
    }

    // Get dominant badge category per tag
    const dominantData = await client.query(
      `SELECT tag_id, badge_category
       FROM v_user_tag_dominant_category
       WHERE user_id = $1`,
      [userId],
    );
    for (const row of dominantData.rows) {
      if (creditMap[row.tag_id]) {
        creditMap[row.tag_id].dominant_badge_category = row.badge_category;
      }
    }

    // Delete existing tags for this user
    await client.query("DELETE FROM user_tags WHERE user_id = $1", [userId]);

    // Insert new tags
    if (tags && tags.length > 0) {
      const tagInserts = tags.map((tag) =>
        client.query(
          `
          INSERT INTO user_tags (user_id, tag_id, experience_level, interest_level, badge_credits, dominant_badge_category)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
          [
            userId,
            tag.tag_id || tag.id,
            tag.experience_level || 2,
            tag.interest_level || 3,
            creditMap[tag.tag_id || tag.id]?.badge_credits || 0,
            creditMap[tag.tag_id || tag.id]?.dominant_badge_category || null,
          ],
        ),
      );

      await Promise.all(tagInserts);
    }

    await client.query("COMMIT");

    // Fetch the updated tags
    const result = await pool.query(
      `
     SELECT 
  t.id,
  t.name,
  t.category,
  t.supercategory,
  ut.experience_level,
  ut.interest_level,
  ut.badge_credits,
  ut.dominant_badge_category,
  (SELECT COUNT(*) FROM badge_awards ba WHERE ba.tag_id = t.id AND ba.awarded_to_user_id = ut.user_id) AS linked_badge_count,
  (SELECT COUNT(DISTINCT ba.awarded_by_user_id) FROM badge_awards ba WHERE ba.tag_id = t.id AND ba.awarded_to_user_id = ut.user_id) AS awarder_count
FROM user_tags ut
JOIN tags t ON ut.tag_id = t.id
WHERE ut.user_id = $1
    `,
      [userId],
    );

    res.status(200).json({
      success: true,
      message: "Tags updated successfully",
      data: result.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating user tags:", error);
    res.status(500).json({
      success: false,
      message: "Error updating user tags",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

/**
 * @description Get badges for a specific user
 * @route GET /api/users/:id/badges
 * @access Public
 */
const getUserBadges = async (req, res) => {
  try {
    const userId = req.params.id;

    const result = await pool.query(
      `
      SELECT
        ba.id AS award_id,

        -- badge fields
        b.id AS badge_id,
        b.name AS badge_name,
        b.description AS badge_description,
        b.category AS badge_category,
        b.image_url AS badge_image_url,
        b.color AS badge_color,
        b.cat_image_url AS badge_category_image_url,

        -- award fields
        ba.credits,
        ba.created_at AS awarded_at,
        ba.reason,
        ba.context_type,
        ba.context_id,
        ba.team_id,
        tag.name AS tag_name,
        tag.category AS tag_category,
        t.name AS team_name,

        -- awarder fields
        ba.awarded_by_user_id AS awarded_by_user_id,
        awarder.username AS awarded_by_username,
        awarder.first_name AS awarded_by_first_name,
        awarder.last_name AS awarded_by_last_name,
        awarder.avatar_url AS awarded_by_avatar_url

      FROM badge_awards ba
      JOIN badges b ON ba.badge_id = b.id
      LEFT JOIN users awarder ON ba.awarded_by_user_id = awarder.id
      LEFT JOIN teams t ON ba.team_id = t.id
      LEFT JOIN tags tag ON ba.tag_id = tag.id
      WHERE ba.awarded_to_user_id = $1
      ORDER BY ba.created_at DESC, ba.id DESC
      `,
      [userId],
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Error fetching user badges:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user badges",
      error: error.message,
    });
  }
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  deleteAvatar,
  getUserTags,
  updateUserTags,
  getUserBadges,
};
