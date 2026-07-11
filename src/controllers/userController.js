const db = require("../config/database");
const { pool } = db;
const {
  hasLocationChanged,
  resolveLocationData,
} = require("../utils/geocodingUtil");
const { deleteImageKitFile } = require("../utils/imagekitUtils");
const { ensureBadgeVisibilityColumns } = require("../utils/badgeVisibilityUtils");
const userModel = require("../models/userModel");

const PUBLIC_USER_FIELDS = `
  u.id, u.username, u.first_name, u.last_name, u.bio,
  u.avatar_url, u.postal_code, u.city, u.state, u.district, u.country, u.is_public,
  u.is_synthetic, u.created_at
`;

const SAFE_PUBLIC_USER_KEYS = [
  'id', 'username', 'first_name', 'last_name', 'bio',
  'avatar_url', 'postal_code', 'city', 'state', 'district', 'country', 'is_public',
  'is_synthetic', 'created_at', 'tags',
];

const sanitizePublicUser = (row) => {
  const safe = {};
  for (const key of SAFE_PUBLIC_USER_KEYS) {
    if (row[key] !== undefined) safe[key] = row[key];
  }
  return safe;
};

/**
 * @description Get all users
 * @route GET /api/users
 * @access Public
 */
const getUsers = async (req, res) => {
  try {
    const viewerId = req.user?.id ?? null;
    // Hide anyone in a block relationship with the viewer (mutual). When the
    // request is unauthenticated, viewerId is null and the filter is a no-op.
    const blockFilter = viewerId
      ? `AND NOT EXISTS (
           SELECT 1 FROM user_blocks ub
           WHERE (ub.blocker_id = u.id AND ub.blocked_id = $1)
              OR (ub.blocked_id = u.id AND ub.blocker_id = $1)
         )`
      : "";
    const result = await pool.query(
      `
      SELECT ${PUBLIC_USER_FIELDS}
      FROM users u
      WHERE u.is_public = TRUE
      ${blockFilter}
      ORDER BY u.created_at DESC
      LIMIT 50
    `,
      viewerId ? [viewerId] : [],
    );

    res.status(200).json({
      success: true,
      data: result.rows.map(sanitizePublicUser),
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching users",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * @description Get a single user by ID
 * @route GET /api/users/:id
 * @access Public (with optional auth for owner-only fields)
 */
const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    const isOwner = req.user && Number(req.user.id) === Number(userId);

    if (process.env.NODE_ENV !== "production") {
      console.log(`Fetching user with ID: ${userId}`);
    }

    await ensureBadgeVisibilityColumns();

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
    u.district,
    u.latitude,
    u.longitude,
    u.avatar_url,
    u.is_public,
    u.is_synthetic,
    COALESCE(u.hide_badges, FALSE) AS hide_badges,
    COALESCE(u.hidden_badge_ids, '{}'::INTEGER[]) AS hidden_badge_ids,
    COALESCE(u.hidden_award_ids, '{}'::INTEGER[]) AS hidden_award_ids,
    u.created_at,
    u.updated_at,
    COALESCE((
      SELECT SUM(ba.credits)
      FROM badge_awards ba
      WHERE ba.awarded_to_user_id = u.id
        AND (
          $2::BOOLEAN = TRUE
          OR NOT (ba.id = ANY(COALESCE(u.hidden_award_ids, '{}'::INTEGER[])))
        )
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
            'id', badge_rows.badge_id,
            'name', badge_rows.badge_name,
            'category', badge_rows.category,
            'color', badge_rows.badge_color,
            'cat_image_url', badge_rows.cat_image_url,
            'total_credits', badge_rows.total_credits,
            'award_count', badge_rows.award_count,
            'awarder_count', badge_rows.awarder_count,
            'category_total_credits', badge_rows.category_total_credits,
            'category_award_count', badge_rows.category_award_count,
            'category_awarder_count', badge_rows.category_awarder_count,
            'last_awarded_at', badge_rows.last_awarded_at
          )
          ORDER BY
            badge_rows.category_total_credits DESC,
            badge_rows.category ASC,
            badge_rows.total_credits DESC,
            badge_rows.badge_name ASC
        ),
        '[]'::json
      )
      FROM (
        WITH visible_awards AS (
          SELECT
            ba.id,
            ba.badge_id,
            ba.credits,
            ba.awarded_by_user_id,
            ba.created_at,
            b.name AS badge_name,
            b.category,
            b.color AS badge_color,
            b.cat_image_url
          FROM badge_awards ba
          JOIN badges b ON b.id = ba.badge_id
          WHERE ba.awarded_to_user_id = u.id
            AND (
              $2::BOOLEAN = TRUE
              OR NOT (ba.id = ANY(COALESCE(u.hidden_award_ids, '{}'::INTEGER[])))
            )
        ),
        badge_totals AS (
          SELECT
            badge_id,
            badge_name,
            category,
            badge_color,
            cat_image_url,
            COALESCE(SUM(credits), 0)::INT AS total_credits,
            COUNT(*)::INT AS award_count,
            COUNT(DISTINCT awarded_by_user_id)::INT AS awarder_count,
            MAX(created_at) AS last_awarded_at
          FROM visible_awards
          GROUP BY badge_id, badge_name, category, badge_color, cat_image_url
        ),
        category_totals AS (
          SELECT
            category,
            COALESCE(SUM(credits), 0)::INT AS category_total_credits,
            COUNT(*)::INT AS category_award_count,
            COUNT(DISTINCT awarded_by_user_id)::INT AS category_awarder_count
          FROM visible_awards
          GROUP BY category
        )
        SELECT
          bt.*,
          ct.category_total_credits,
          ct.category_award_count,
          ct.category_awarder_count
        FROM badge_totals bt
        JOIN category_totals ct ON ct.category = bt.category
      ) badge_rows
    ) as badges

  FROM users u
  WHERE u.id = $1
`,
      [userId, isOwner],
    );

    if (result.rows.length === 0) {
      // The frontend treats a 404 for a valid-looking profile ID as
      // "This user has left Lomir" and renders the deleted-user placeholder.
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    // Blocked users are mutually hidden: if either party has blocked the other,
    // present the profile as "not found" (same shape the frontend already uses
    // for missing/private-non-shared profiles).
    if (!isOwner && req.user) {
      const blocked = await userModel.isBlockedBetween(req.user.id, userId);
      if (blocked) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
    }

    if (!isOwner && !user.is_public) {
      // Teammates may see the full sanitized profile even if it is private
      let sharesTeam = false;
      if (req.user) {
        const teamCheck = await pool.query(
          `SELECT 1 FROM team_members tm1
           JOIN team_members tm2 ON tm1.team_id = tm2.team_id
           WHERE tm1.user_id = $1 AND tm2.user_id = $2
           LIMIT 1`,
          [req.user.id, userId],
        );
        sharesTeam = teamCheck.rows.length > 0;
      }

      if (!sharesTeam) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
    }

    if (!isOwner) {
      const publicData = sanitizePublicUser(user);
      if (user.hide_badges) {
        publicData.badges = [];
        publicData.total_badge_credits = 0;
      } else {
        if (user.badges !== undefined) publicData.badges = user.badges;
        if (user.total_badge_credits !== undefined) publicData.total_badge_credits = user.total_badge_credits;
      }
      if (user.hide_badges !== undefined) publicData.hide_badges = user.hide_badges;
      if (user.updated_at !== undefined) publicData.updated_at = user.updated_at;

      return res.status(200).json({
        success: true,
        message: "User retrieved successfully",
        data: publicData,
      });
    }

    // Owner view: include email and hidden award metadata needed for settings
    res.status(200).json({
      success: true,
      message: "User retrieved successfully",
      data: user,
    });
  } catch (error) {
    console.error(`Error fetching user ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error fetching user",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
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
    if (Number(req.user.id) !== Number(req.params.id)) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own profile",
      });
    }

    const userId = req.params.id;
    if (process.env.NODE_ENV !== "production") {
      console.log("updateUser called for ID:", userId);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "email")) {
      return res.status(400).json({
        success: false,
        message: "Use the account email change flow to change your email address",
      });
    }

    // First, get the current user data to access the old avatar URL and location
    const currentUserResult = await pool.query(
      "SELECT avatar_url, avatar_file_id, postal_code, city, country, state, district, latitude, longitude FROM users WHERE id = $1",
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
    const oldAvatarFileId = currentUser.avatar_file_id;

    // Extract all relevant fields from request body
    const {
      first_name,
      last_name,
      username,
      bio,
      postal_code,
      city,
      state,
      district,
      country,
      avatar_url,
      avatar_file_id,
      is_public,
    } = req.body;
    const nextAvatarFileId =
      avatar_file_id === "" ? null : (avatar_file_id ?? null);

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
    if (bio !== undefined) {
      updateFields.push(`bio = $${paramPosition}`);
      queryParams.push(bio);
      paramPosition++;
    }
    if (postal_code !== undefined) {
      updateFields.push(`postal_code = $${paramPosition}`);
      queryParams.push(postal_code || null);
      paramPosition++;
    }
    if (city !== undefined) {
      updateFields.push(`city = $${paramPosition}`);
      queryParams.push(city || null);
      paramPosition++;
    }
    if (state !== undefined) {
      updateFields.push(`state = $${paramPosition}`);
      queryParams.push(state || null);
      paramPosition++;
    }
    if (district !== undefined) {
      updateFields.push(`district = $${paramPosition}`);
      queryParams.push(district || null);
      paramPosition++;
    }
    if (country !== undefined) {
      updateFields.push(`country = $${paramPosition}`);
      queryParams.push(country || null);
      paramPosition++;
    }

    // Handle avatar URL update with old image deletion
    if (avatar_url !== undefined) {
      updateFields.push(`avatar_url = $${paramPosition}`);
      queryParams.push(avatar_url);
      paramPosition++;

      updateFields.push(`avatar_file_id = $${paramPosition}`);
      queryParams.push(nextAvatarFileId);
      paramPosition++;

      // Delete old image from ImageKit if it exists and is different from the new one
      if ((oldAvatarUrl || oldAvatarFileId) && oldAvatarUrl !== avatar_url) {
        if (process.env.NODE_ENV !== "production") {
          console.log(`Attempting to delete old avatar from ImageKit: ${oldAvatarUrl}`);
        }

        await deleteImageKitFile(oldAvatarUrl, oldAvatarFileId);
      }
    }

    // Make sure is_public is explicitly handled
    if (is_public !== undefined) {
      updateFields.push(`is_public = $${paramPosition}`);
      queryParams.push(is_public);
      paramPosition++;
      if (process.env.NODE_ENV !== "production") {
        console.log(`Setting is_public to: ${is_public} (${typeof is_public})`);
      }
    }

    // Check if location data has changed and trigger geocoding
    const newLocationData = {
      postal_code:
        postal_code !== undefined ? postal_code : currentUser.postal_code,
      city: city !== undefined ? city : currentUser.city,
      state: state !== undefined ? state : currentUser.state,
      district: district !== undefined ? district : currentUser.district,
      country: country !== undefined ? country : currentUser.country,
    };

    const locationChanged = hasLocationChanged(newLocationData, currentUser);

    if (locationChanged) {
      if (process.env.NODE_ENV !== "production") {
        console.log("Location data changed, triggering geocoding...");
      }
      const resolvedLocation = await resolveLocationData(newLocationData);

      if (resolvedLocation) {
        if (process.env.NODE_ENV !== "production") {
          console.log(
            `Resolved new location: lat=${resolvedLocation.latitude}, lng=${resolvedLocation.longitude}`,
          );
        }
        const locationFieldsToPersist = {
          postal_code: resolvedLocation.postal_code,
          city: resolvedLocation.city,
          state: resolvedLocation.state,
          district: resolvedLocation.district,
          country: resolvedLocation.country,
        };

        for (const [field, fieldValue] of Object.entries(locationFieldsToPersist)) {
          if (!updateFields.some((entry) => entry.startsWith(`${field} = `))) {
            updateFields.push(`${field} = $${paramPosition}`);
            queryParams.push(fieldValue);
            paramPosition++;
          }
        }

        updateFields.push(`latitude = $${paramPosition}`);
        queryParams.push(resolvedLocation.latitude);
        paramPosition++;

        updateFields.push(`longitude = $${paramPosition}`);
        queryParams.push(resolvedLocation.longitude);
        paramPosition++;
      } else {
        if (process.env.NODE_ENV !== "production") {
          console.log(
            "Geocoding failed or returned no results, clearing coordinates",
          );
        }
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

        updateFields.push(`district = $${paramPosition}`);
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
      RETURNING id, username, email, first_name, last_name, bio, postal_code, city, country, state, district, latitude, longitude, avatar_url, is_public, is_synthetic, created_at, updated_at
    `;

    const result = await pool.query(query, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

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
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
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
      "SELECT avatar_url, avatar_file_id FROM users WHERE id = $1",
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentAvatarUrl = userResult.rows[0].avatar_url;
    const currentAvatarFileId = userResult.rows[0].avatar_file_id;

    // Delete from ImageKit if it exists
    if (currentAvatarUrl || currentAvatarFileId) {
      if (process.env.NODE_ENV !== "production") {
        console.log(`Deleting avatar from ImageKit: ${currentAvatarUrl}`);
      }

      await deleteImageKitFile(currentAvatarUrl, currentAvatarFileId);
    }

    // Clear the avatar_url in the database
    await pool.query(
      "UPDATE users SET avatar_url = NULL, avatar_file_id = NULL, updated_at = NOW() WHERE id = $1",
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
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deleteAvatar,
};
