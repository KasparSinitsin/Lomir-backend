const db = require("../config/database");
const { pool } = db;
const bcrypt = require("bcrypt");
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

const buildUserDisplayName = (user) => {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return fullName || user.username;
};

const toIsoString = (value) => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
};

const logDeletionPhase = (phase, details) => {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  if (details !== undefined) {
    console.log(`[deleteUser] ${phase}`, details);
    return;
  }

  console.log(`[deleteUser] ${phase}`);
};

const insertNotificationRecord = async (
  client,
  {
    userId,
    type,
    title,
    message = null,
    referenceType = null,
    referenceId = null,
    teamId = null,
    actorId = null,
  },
) => {
  await client.query(
    `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id, team_id, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      type,
      title,
      message,
      referenceType,
      referenceId,
      teamId,
      actorId,
    ],
  );
};

const getSuccessorCandidatesByTeam = async (queryable, teamIds, excludedUserId) => {
  if (teamIds.length === 0) {
    return new Map();
  }

  const result = await queryable.query(
    `
    SELECT
      tm.team_id,
      tm.user_id,
      tm.role,
      tm.joined_at,
      u.first_name,
      u.last_name,
      u.username
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ANY($1::int[])
      AND tm.user_id != $2
      AND tm.role IN ('admin', 'member')
    ORDER BY
      tm.team_id ASC,
      CASE
        WHEN tm.role = 'admin' THEN 0
        WHEN tm.role = 'member' THEN 1
        ELSE 2
      END,
      tm.joined_at ASC NULLS LAST,
      tm.user_id ASC
    `,
    [teamIds, excludedUserId],
  );

  const candidatesByTeamId = new Map();

  for (const row of result.rows) {
    const teamId = Number(row.team_id);
    const existingCandidates = candidatesByTeamId.get(teamId) || [];

    existingCandidates.push({
      userId: Number(row.user_id),
      name: buildUserDisplayName(row),
      role: row.role,
      joinedAt: toIsoString(row.joined_at),
    });

    candidatesByTeamId.set(teamId, existingCandidates);
  }

  return candidatesByTeamId;
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
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
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
    if (process.env.NODE_ENV !== "production") {
      console.log(`Fetching user with ID: ${userId}`);
    }

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
    const userId = req.params.id;
    if (process.env.NODE_ENV !== "production") {
      console.log("updateUser called for ID:", userId);
    }

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
            if (process.env.NODE_ENV !== "production") {
              console.log(
                `Attempting to delete old avatar from Cloudinary: ${publicId}`,
              );
            }
            const deleteResult = await cloudinary.uploader.destroy(publicId);
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
      if (process.env.NODE_ENV !== "production") {
        console.log(`Setting is_public to: ${is_public} (${typeof is_public})`);
      }
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
      if (process.env.NODE_ENV !== "production") {
        console.log("Location data changed, triggering geocoding...");
      }
      const coordinates = await geocodeAddress(newLocationData);

      if (coordinates) {
        if (process.env.NODE_ENV !== "production") {
          console.log(
            `Geocoded new coordinates: lat=${coordinates.latitude}, lng=${coordinates.longitude}`,
          );
        }
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
          if (process.env.NODE_ENV !== "production") {
            console.log(`Deleting avatar from Cloudinary: ${publicId}`);
          }
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
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * @description Delete a user's account
 * @route DELETE /api/users/:id
 * @access Private (Requires authentication and authorization)
 */
const deleteUser = async (req, res) => {
  let client = null;
  let transactionOpen = false;
  let avatarUrl = null;
  let teamIdsForSockets = [];
  let dmPartnerIds = [];
  let ownershipTransferEvents = [];
  let reopenedRoleEvents = [];

  try {
    const userId = parseInt(req.params.id, 10);
    const { password, ownershipOverrides = [] } = req.body || {};

    // Verify the user making the request is the same as the user being deleted
    if (Number(req.user.id) !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own account",
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    if (!Array.isArray(ownershipOverrides)) {
      return res.status(400).json({
        success: false,
        message: "ownershipOverrides must be an array",
      });
    }

    const ownershipOverrideMap = new Map();

    for (const override of ownershipOverrides) {
      const teamId = Number(override?.teamId);
      const successorId = Number(override?.successorId);

      if (!Number.isInteger(teamId) || !Number.isInteger(successorId)) {
        return res.status(400).json({
          success: false,
          message: "Each ownership override must include teamId and successorId",
        });
      }

      ownershipOverrideMap.set(teamId, successorId);
    }

    client = await db.pool.connect();

    const rollbackAndRespond = async (status, payload) => {
      if (transactionOpen) {
        await client.query("ROLLBACK");
        transactionOpen = false;
      }

      return res.status(status).json(payload);
    };

    await client.query("BEGIN");
    transactionOpen = true;

    logDeletionPhase("Phase A - gather context", { userId });

    const userResult = await client.query(
      `SELECT id, first_name, last_name, username, avatar_url, password_hash
       FROM users
       WHERE id = $1`,
      [userId],
    );

    if (userResult.rows.length === 0) {
      return rollbackAndRespond(404, {
        success: false,
        message: "User not found",
      });
    }

    const user = userResult.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return rollbackAndRespond(401, {
        success: false,
        message: "Password is incorrect",
      });
    }

    avatarUrl = user.avatar_url;

    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
    const userDisplayName = fullName || user.username;

    const [
      membershipsResult,
      ownedTeamsResult,
      filledRolesResult,
      dmPartnersResult,
    ] = await Promise.all([
      client.query(
        `
        SELECT
          tm.team_id,
          tm.role,
          tm.joined_at,
          t.name AS team_name
        FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        WHERE tm.user_id = $1
        ORDER BY t.name ASC, tm.team_id ASC
        `,
        [userId],
      ),
      client.query(
        `
        SELECT
          t.id AS team_id,
          t.name AS team_name,
          COUNT(tm_all.user_id)::int AS member_count,
          (COUNT(tm_all.user_id) FILTER (WHERE tm_all.user_id != $1))::int AS other_member_count
        FROM teams t
        JOIN team_members tm_owner
          ON tm_owner.team_id = t.id
         AND tm_owner.user_id = $1
         AND tm_owner.role = 'owner'
        JOIN team_members tm_all ON tm_all.team_id = t.id
        GROUP BY t.id, t.name
        ORDER BY t.name ASC, t.id ASC
        `,
        [userId],
      ),
      client.query(
        `
        SELECT
          vr.id AS role_id,
          vr.role_name,
          vr.team_id,
          t.name AS team_name
        FROM team_vacant_roles vr
        JOIN teams t ON t.id = vr.team_id
        WHERE vr.filled_by = $1
          AND vr.status = 'filled'
        ORDER BY t.name ASC, vr.role_name ASC, vr.id ASC
        `,
        [userId],
      ),
      client.query(
        `
        SELECT DISTINCT
          CASE
            WHEN sender_id = $1 THEN receiver_id
            ELSE sender_id
          END AS partner_id
        FROM messages
        WHERE team_id IS NULL
          AND (sender_id = $1 OR receiver_id = $1)
          AND (
            CASE
              WHEN sender_id = $1 THEN receiver_id
              ELSE sender_id
            END
          ) IS NOT NULL
        `,
        [userId],
      ),
    ]);

    const memberships = membershipsResult.rows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      role: row.role,
      joinedAt: toIsoString(row.joined_at),
    }));

    const ownedTeams = ownedTeamsResult.rows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      memberCount: Number(row.member_count),
      otherMemberCount: Number(row.other_member_count),
    }));

    const teamsToDelete = ownedTeams.filter((team) => team.otherMemberCount === 0);
    const teamsToTransfer = ownedTeams.filter((team) => team.otherMemberCount > 0);
    const teamsToTransferIdSet = new Set(
      teamsToTransfer.map((team) => team.teamId),
    );

    const invalidOverrideTeamIds = Array.from(ownershipOverrideMap.keys()).filter(
      (teamId) => !teamsToTransferIdSet.has(teamId),
    );

    if (invalidOverrideTeamIds.length > 0) {
      return rollbackAndRespond(400, {
        success: false,
        message:
          "Ownership overrides can only be provided for teams that require ownership transfer",
      });
    }

    const filledRoles = filledRolesResult.rows.map((row) => ({
      roleId: Number(row.role_id),
      roleName: row.role_name,
      teamId: Number(row.team_id),
      teamName: row.team_name,
    }));

    teamIdsForSockets = Array.from(
      new Set(memberships.map((membership) => membership.teamId)),
    );
    dmPartnerIds = dmPartnersResult.rows
      .map((row) => Number(row.partner_id))
      .filter((partnerId) => Number.isInteger(partnerId));

    logDeletionPhase("Phase B - messages and chat cleanup", {
      teamCount: memberships.length,
      dmPartnerCount: dmPartnerIds.length,
    });

    await client.query(
      `DELETE FROM messages
       WHERE (sender_id = $1 OR receiver_id = $1)
         AND team_id IS NULL`,
      [userId],
    );

    for (const membership of memberships) {
      await client.query(
        `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())`,
        [null, membership.teamId, `🚪 ${userDisplayName} has left Lomir.`],
      );
    }

    await client.query(
      `
      UPDATE messages
      SET content = CASE
        WHEN $2 <> ''
          THEN REPLACE(REPLACE(content, $2, 'Former Lomir User'), $3, 'Former Lomir User')
        ELSE REPLACE(content, $3, 'Former Lomir User')
      END
      WHERE sender_id = $1
        AND team_id IS NOT NULL
        AND (
          content LIKE '%👋%'
          OR content LIKE '%🚪%'
          OR content LIKE '%👑%'
          OR content LIKE '%🎯%'
          OR content LIKE '%✅%'
          OR content LIKE '%❌%'
          OR content LIKE '%🎉%'
          OR content LIKE '%🔓%'
        )
      `,
      [userId, fullName, user.username],
    );

    logDeletionPhase("Phase C - team ownership cleanup", {
      teamsToDelete: teamsToDelete.length,
      teamsToTransfer: teamsToTransfer.length,
    });

    const deletedTeamIds = new Set();

    for (const team of teamsToDelete) {
      const dissolutionTitle = `The team ${team.teamName} has been dissolved`;

      await client.query(
        `
        UPDATE badge_awards
        SET custom_team_name = (SELECT name FROM teams WHERE id = $1),
            team_id = NULL
        WHERE team_id = $1
          AND team_id IS NOT NULL
        `,
        [team.teamId],
      );

      const pendingApplicantsResult = await client.query(
        `
        SELECT DISTINCT applicant_id
        FROM team_applications
        WHERE team_id = $1
          AND status = 'pending'
        `,
        [team.teamId],
      );

      for (const applicant of pendingApplicantsResult.rows) {
        await insertNotificationRecord(client, {
          userId: Number(applicant.applicant_id),
          type: "team_dissolved",
          title: dissolutionTitle,
          actorId: userId,
        });
      }

      const pendingInviteesResult = await client.query(
        `
        SELECT DISTINCT invitee_id
        FROM team_invitations
        WHERE team_id = $1
          AND status = 'pending'
        `,
        [team.teamId],
      );

      for (const invitee of pendingInviteesResult.rows) {
        await insertNotificationRecord(client, {
          userId: Number(invitee.invitee_id),
          type: "team_dissolved",
          title: dissolutionTitle,
          actorId: userId,
        });
      }

      await client.query("DELETE FROM team_invitations WHERE team_id = $1", [
        team.teamId,
      ]);
      await client.query("DELETE FROM team_applications WHERE team_id = $1", [
        team.teamId,
      ]);
      await client.query("DELETE FROM messages WHERE team_id = $1", [team.teamId]);
      await client.query(
        `
        DELETE FROM notifications
        WHERE team_id = $1
          AND reference_type IN ('team_member', 'team_application', 'team_invitation')
        `,
        [team.teamId],
      );
      await client.query(
        `
        DELETE FROM team_vacant_role_tags
        WHERE role_id IN (
          SELECT id FROM team_vacant_roles WHERE team_id = $1
        )
        `,
        [team.teamId],
      );
      await client.query(
        `
        DELETE FROM team_vacant_role_badges
        WHERE role_id IN (
          SELECT id FROM team_vacant_roles WHERE team_id = $1
        )
        `,
        [team.teamId],
      );
      await client.query("DELETE FROM team_vacant_roles WHERE team_id = $1", [
        team.teamId,
      ]);
      await client.query("DELETE FROM team_tags WHERE team_id = $1", [team.teamId]);
      await client.query("DELETE FROM team_members WHERE team_id = $1", [
        team.teamId,
      ]);
      await client.query("DELETE FROM teams WHERE id = $1", [team.teamId]);

      deletedTeamIds.add(team.teamId);
    }

    const successorCandidatesByTeam = await getSuccessorCandidatesByTeam(
      client,
      teamsToTransfer.map((team) => team.teamId),
      userId,
    );

    for (const team of teamsToTransfer) {
      const overrideSuccessorId = ownershipOverrideMap.get(team.teamId);
      const candidates = successorCandidatesByTeam.get(team.teamId) || [];

      let successor = null;

      if (overrideSuccessorId !== undefined) {
        successor = candidates.find(
          (candidate) => candidate.userId === overrideSuccessorId,
        );

        if (!successor) {
          return rollbackAndRespond(400, {
            success: false,
            message: `Invalid ownership override for team ${team.teamName}`,
          });
        }
      } else {
        successor = candidates[0] || null;
      }

      if (!successor) {
        throw new Error(`No successor candidate found for team ${team.teamId}`);
      }

      await client.query(
        `
        UPDATE team_members
        SET role = 'owner'
        WHERE team_id = $1
          AND user_id = $2
        `,
        [team.teamId, successor.userId],
      );

      await client.query(
        `
        UPDATE teams
        SET owner_id = $1
        WHERE id = $2
        `,
        [successor.userId, team.teamId],
      );

      await insertNotificationRecord(client, {
        userId: successor.userId,
        type: "ownership_transferred",
        title: `You are now the owner of ${team.teamName}`,
        referenceType: "team_member",
        referenceId: team.teamId,
        teamId: team.teamId,
        actorId: userId,
      });

      await client.query(
        `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          null,
          team.teamId,
          `👑 OWNERSHIP_TEAM: ${userDisplayName} | ${successor.name}`,
        ],
      );

      ownershipTransferEvents.push({
        successorId: successor.userId,
        teamId: team.teamId,
      });
    }

    logDeletionPhase("Phase D - role and reference cleanup", {
      filledRoleCount: filledRoles.length,
    });

    const reopenedRoles = filledRoles.filter(
      (role) => !deletedTeamIds.has(role.teamId),
    );

    await client.query(
      `
      UPDATE team_vacant_roles
      SET status = 'open',
          filled_by = NULL,
          updated_at = NOW()
      WHERE filled_by = $1
      `,
      [userId],
    );

    if (reopenedRoles.length > 0) {
      const reopenedTeamIds = Array.from(
        new Set(reopenedRoles.map((role) => role.teamId)),
      );

      const roleRecipientsResult = await client.query(
        `
        SELECT team_id, user_id
        FROM team_members
        WHERE team_id = ANY($1::int[])
          AND role IN ('owner', 'admin')
          AND user_id != $2
        ORDER BY team_id ASC, user_id ASC
        `,
        [reopenedTeamIds, userId],
      );

      const roleRecipientsByTeamId = new Map();

      for (const row of roleRecipientsResult.rows) {
        const teamId = Number(row.team_id);
        const currentRecipients = roleRecipientsByTeamId.get(teamId) || [];
        currentRecipients.push(Number(row.user_id));
        roleRecipientsByTeamId.set(teamId, currentRecipients);
      }

      for (const role of reopenedRoles) {
        await client.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [null, role.teamId, `🔓 The role ${role.roleName} is now open again.`],
        );

        const recipients = roleRecipientsByTeamId.get(role.teamId) || [];

        for (const recipientId of recipients) {
          await insertNotificationRecord(client, {
            userId: recipientId,
            type: "role_reopened",
            title: `The role ${role.roleName} is now open again in ${role.teamName}`,
            teamId: role.teamId,
            actorId: userId,
          });
        }

        reopenedRoleEvents.push({
          teamId: role.teamId,
        });
      }
    }

    await client.query(
      `UPDATE team_vacant_roles SET created_by = NULL WHERE created_by = $1`,
      [userId],
    );
    await client.query(
      `UPDATE team_applications SET reviewed_by = NULL WHERE reviewed_by = $1`,
      [userId],
    );
    await client.query(
      `UPDATE user_badges SET awarded_by = NULL WHERE awarded_by = $1`,
      [userId],
    );
    await client.query(`UPDATE tags SET created_by = NULL WHERE created_by = $1`, [
      userId,
    ]);
    await client.query(
      `UPDATE messages SET deleted_by = NULL WHERE deleted_by = $1`,
      [userId],
    );
    await client.query(
      `
      UPDATE notifications
      SET reference_id = NULL
      WHERE actor_id = $1
        AND reference_type IN ('team_invitation', 'team_application', 'badge_award')
      `,
      [userId],
    );

    logDeletionPhase("Phase E - delete user row", { userId });

    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("COMMIT");
    transactionOpen = false;

    logDeletionPhase("Phase F - post-transaction cleanup", {
      teamEventCount: teamIdsForSockets.length,
      dmPartnerCount: dmPartnerIds.length,
    });

    try {
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

      const io =
        req.app && typeof req.app.get === "function" ? req.app.get("io") : null;

      if (io) {
        for (const teamId of teamIdsForSockets) {
          io.to(`team:${teamId}`).emit("team:member_left", { teamId, userId });
        }

        for (const partnerId of dmPartnerIds) {
          io.to(`user:${partnerId}`).emit("conversation:deleted", {
            partnerId: userId,
          });
        }

        for (const event of ownershipTransferEvents) {
          io.to(`user:${event.successorId}`).emit("notification:new", {
            type: "ownership_transferred",
            teamId: event.teamId,
          });
        }

        for (const event of reopenedRoleEvents) {
          io.to(`team:${event.teamId}`).emit("notification:new", {
            type: "role_reopened",
            teamId: event.teamId,
          });
        }
      }
    } catch (postCommitError) {
      console.error("Error during post-transaction user deletion cleanup:", postCommitError);
    }

    return res.status(200).json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Error rolling back user deletion:", rollbackError);
      }
    }

    console.error("Error deleting user:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting user",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * @description Preview the impact of deleting a user's account
 * @route POST /api/users/:id/deletion-preview
 * @access Private (Requires authentication and password verification)
 */
const deletionPreview = async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { password } = req.body;

    if (Number(req.user.id) !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only preview deletion for your own account",
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    const userResult = await pool.query(
      "SELECT id, password_hash FROM users WHERE id = $1",
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      userResult.rows[0].password_hash,
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Password is incorrect",
      });
    }

    const [
      ownedTeamsResult,
      rolesToReopenResult,
      badgeAwardsGivenResult,
      teamMembershipsResult,
      directMessagesResult,
    ] = await Promise.all([
      pool.query(
        `
        SELECT
          t.id AS team_id,
          t.name AS team_name,
          COUNT(tm_all.user_id)::int AS member_count,
          (COUNT(tm_all.user_id) FILTER (WHERE tm_all.user_id != $1))::int AS other_member_count
        FROM teams t
        JOIN team_members tm_owner
          ON tm_owner.team_id = t.id
         AND tm_owner.user_id = $1
         AND tm_owner.role = 'owner'
        JOIN team_members tm_all ON tm_all.team_id = t.id
        GROUP BY t.id, t.name
        ORDER BY t.name ASC, t.id ASC
        `,
        [userId],
      ),
      pool.query(
        `
        SELECT
          vr.id AS role_id,
          vr.role_name,
          vr.team_id,
          t.name AS team_name
        FROM team_vacant_roles vr
        JOIN teams t ON t.id = vr.team_id
        WHERE vr.filled_by = $1
          AND vr.status = 'filled'
        ORDER BY t.name ASC, vr.role_name ASC, vr.id ASC
        `,
        [userId],
      ),
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM badge_awards
        WHERE awarded_by_user_id = $1
        `,
        [userId],
      ),
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM team_members
        WHERE user_id = $1
        `,
        [userId],
      ),
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM messages
        WHERE (sender_id = $1 OR receiver_id = $1)
          AND team_id IS NULL
        `,
        [userId],
      ),
    ]);

    const ownedTeams = ownedTeamsResult.rows;
    const teamIdsToTransfer = ownedTeams
      .filter((team) => Number(team.other_member_count) > 0)
      .map((team) => Number(team.team_id));

    let successorByTeamId = new Map();

    if (teamIdsToTransfer.length > 0) {
      const successorsResult = await pool.query(
        `
        SELECT
          ranked.team_id,
          ranked.user_id,
          ranked.role,
          ranked.joined_at,
          ranked.first_name,
          ranked.last_name,
          ranked.username
        FROM (
          SELECT
            tm.team_id,
            tm.user_id,
            tm.role,
            tm.joined_at,
            u.first_name,
            u.last_name,
            u.username,
            ROW_NUMBER() OVER (
              PARTITION BY tm.team_id
              ORDER BY
                CASE
                  WHEN tm.role = 'admin' THEN 0
                  WHEN tm.role = 'member' THEN 1
                  ELSE 2
                END,
                tm.joined_at ASC NULLS LAST,
                tm.user_id ASC
            ) AS row_number
          FROM team_members tm
          JOIN users u ON u.id = tm.user_id
          WHERE tm.team_id = ANY($1::int[])
            AND tm.user_id != $2
            AND tm.role IN ('admin', 'member')
        ) ranked
        WHERE ranked.row_number = 1
        `,
        [teamIdsToTransfer, userId],
      );

      successorByTeamId = new Map(
        successorsResult.rows.map((row) => [
          Number(row.team_id),
          {
            userId: Number(row.user_id),
            name: buildUserDisplayName(row),
            role: row.role,
            joinedAt: toIsoString(row.joined_at),
          },
        ]),
      );
    }

    const teamsToDelete = [];
    const teamsToTransfer = [];

    for (const team of ownedTeams) {
      const teamId = Number(team.team_id);
      const memberCount = Number(team.member_count);
      const otherMemberCount = Number(team.other_member_count);

      if (otherMemberCount === 0) {
        teamsToDelete.push({
          teamId,
          teamName: team.team_name,
        });
        continue;
      }

      const successor = successorByTeamId.get(teamId);

      if (!successor) {
        throw new Error(`No successor candidate found for team ${teamId}`);
      }

      teamsToTransfer.push({
        teamId,
        teamName: team.team_name,
        successor,
        memberCount,
      });
    }

    const rolesToReopen = rolesToReopenResult.rows.map((row) => ({
      roleId: Number(row.role_id),
      roleName: row.role_name,
      teamId: Number(row.team_id),
      teamName: row.team_name,
    }));

    res.status(200).json({
      success: true,
      data: {
        teamsToTransfer,
        teamsToDelete,
        rolesToReopen,
        counts: {
          badgeAwardsGiven: Number(badgeAwardsGivenResult.rows[0].count),
          teamMemberships: Number(teamMembershipsResult.rows[0].count),
          directMessages: Number(directMessagesResult.rows[0].count),
        },
      },
    });
  } catch (error) {
    console.error("Error generating deletion preview:", error);
    res.status(500).json({
      success: false,
      message: "Error generating deletion preview",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
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
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
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
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
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
        ba.custom_team_name,
        ba.project_name,
        tag.name AS tag_name,
        tag.category AS tag_category,
        COALESCE(t.name, ba.custom_team_name) AS team_name,

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
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deletionPreview,
  deleteUser,
  deleteAvatar,
  getUserTags,
  updateUserTags,
  getUserBadges,
};
