const db = require("../config/database");
const Joi = require("joi");
const { resolveLocationData } = require("../utils/geocodingUtil");
const {
  createNotification,
  notifyTeamMembers,
  notifyTeamAdmins,
} = require("./notificationController");
const { computeDistanceScore, WEIGHTS } = require("./matchingController");
const { serializeEmbeddedVacantRole } = require("../utils/vacantRoleSerializer");
const { deleteImageKitFile } = require("../utils/imagekitUtils");
const { emitInsertedMessage } = require("../utils/socketMessageEmitter");

const permanentlyDeleteTeam = async (teamId) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    // Fetch team avatar URL before deleting
    const teamResult = await client.query(
      `SELECT teamavatar_url, teamavatar_file_id FROM teams WHERE id = $1`,
      [teamId],
    );

    const teamAvatarUrl = teamResult.rows[0]?.teamavatar_url;
    const teamAvatarFileId = teamResult.rows[0]?.teamavatar_file_id;

    // Delete all related data in order...
    await client.query("DELETE FROM messages WHERE team_id = $1", [teamId]);
    await client.query("DELETE FROM team_invitations WHERE team_id = $1", [
      teamId,
    ]);
    await client.query("DELETE FROM team_applications WHERE team_id = $1", [
      teamId,
    ]);
    await client.query("DELETE FROM team_tags WHERE team_id = $1", [teamId]);
    await client.query("DELETE FROM user_badges WHERE team_id = $1", [teamId]);
    await client.query("DELETE FROM notifications WHERE team_id = $1", [
      teamId,
    ]);
    await client.query("DELETE FROM team_members WHERE team_id = $1", [teamId]);
    await client.query("DELETE FROM teams WHERE id = $1", [teamId]);

    await client.query("COMMIT");

    // Delete avatar from ImageKit AFTER successful database deletion
    // This is done outside the transaction to prevent rollback issues
    if (teamAvatarUrl || teamAvatarFileId) {
      await deleteImageKitFile(teamAvatarUrl, teamAvatarFileId);
    }

    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const checkAndCleanupArchivedTeam = async (teamId) => {
  const result = await db.pool.query(
    `
     SELECT t.archived_at,
            (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
     FROM teams t WHERE t.id = $1
   `,
    [teamId],
  );

  if (result.rows.length > 0) {
    const team = result.rows[0];
    if (team.archived_at && parseInt(team.member_count) === 0) {
      await permanentlyDeleteTeam(teamId);
      return true;
    }
  }
  return false;
};

const deleteTeamAvatar = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Check if team exists and user is the owner or admin
    const teamCheck = await db.pool.query(
      `
      SELECT t.teamavatar_url, t.teamavatar_file_id, tm.role
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE t.id = $1 
      AND tm.user_id = $2 
      AND (tm.role = 'owner' OR tm.role = 'admin')
      AND t.archived_at IS NULL
    `,
      [teamId, userId],
    );

    if (teamCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this team or team not found",
      });
    }

    const currentAvatarUrl = teamCheck.rows[0].teamavatar_url;
    const currentAvatarFileId = teamCheck.rows[0].teamavatar_file_id;

    // Delete from ImageKit if it exists
    if (currentAvatarUrl || currentAvatarFileId) {
      await deleteImageKitFile(currentAvatarUrl, currentAvatarFileId);
    }

    // Update database to remove avatar URL
    const result = await db.pool.query(
      "UPDATE teams SET teamavatar_url = NULL, teamavatar_file_id = NULL, updated_at = NOW() WHERE id = $1 RETURNING id, teamavatar_url",
      [teamId],
    );

    res.status(200).json({
      success: true,
      message: "Team avatar deleted successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error(`Error deleting avatar for team ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error deleting team avatar",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// Validation schema for team creation
const teamCreationSchema = Joi.object({
  name: Joi.string().trim().min(3).max(100).required().messages({
    "string.empty": "Team name cannot be empty",
    "string.min": "Team name must be at least 3 characters long",
    "string.max": "Team name cannot exceed 100 characters",
    "any.required": "Team name is required",
  }),

  description: Joi.string().trim().min(10).max(500).required().messages({
    "string.empty": "Team description cannot be empty",
    "string.min": "Description must be at least 10 characters long",
    "string.max": "Description cannot exceed 500 characters",
    "any.required": "Team description is required",
  }),

  is_public: Joi.boolean().default(true),

  max_members: Joi.alternatives()
    .try(
      Joi.number().integer().min(2).messages({
        "number.base": "Maximum members must be a number",
        "number.min": "Team must have at least 2 members",
      }),
      Joi.valid(null),
    )
    .required()
    .messages({
      "any.required": "Maximum members is required",
    }),

  // LOCATION FIELDS (move them here!)
  is_remote: Joi.boolean().default(false),
  postal_code: Joi.string().allow(null, "").optional(),
  city: Joi.string().allow(null, "").optional(),
  state: Joi.string().allow(null, "").optional(),
  district: Joi.string().allow(null, "").optional(),
  country: Joi.string().allow(null, "").optional(),

  teamavatar_url: Joi.string().uri().allow(null, "").messages({
    "string.uri": "Team avatar URL must be a valid URL",
  }),

  tags: Joi.array()
    .items(
      Joi.object({
        tag_id: Joi.number().integer().required(),
      }),
    )
    .default([]),
});

const createTeam = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const ownerId = req.user.id;

    const { error, value } = teamCreationSchema.validate(req.body);
    if (error) {
      console.error("--> Validation error:", error.details);
      await client.query("ROLLBACK"); // Rollback on validation error
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        errors: error.details.map((detail) => detail.message),
      });
    }
    if (!value.is_remote && value.country) {
      const resolvedLocation = await resolveLocationData({
        postal_code: value.postal_code,
        city: value.city,
        state: value.state,
        district: value.district,
        country: value.country,
      });

      if (resolvedLocation) {
        value.postal_code = resolvedLocation.postal_code;
        value.city = resolvedLocation.city;
        value.state = resolvedLocation.state;
        value.district = resolvedLocation.district;
        value.country = resolvedLocation.country;
        value.latitude = resolvedLocation.latitude;
        value.longitude = resolvedLocation.longitude;
      }
    }

    // Decide what to insert into max_members
    const maxMembersForInsert =
      value.max_members === undefined ? null : value.max_members;

    await client.query("BEGIN");

    const ownerSyntheticResult = await client.query(
      `SELECT is_synthetic FROM users WHERE id = $1`,
      [ownerId],
    );
    const isOwnerSynthetic = ownerSyntheticResult.rows[0].is_synthetic;

    // Ensure is_public is a proper boolean
    const isPublicBoolean =
      value.is_public === true ||
      value.is_public === "true" ||
      value.is_public === 1;

    const teamResult = await client.query(
      `
  INSERT INTO teams (
    name,
    description,
    owner_id,
    is_public,
    max_members,
    is_remote,
    postal_code,
    city,
    state,
    district,
    country,
    latitude,
    longitude,
    teamavatar_url,
    is_synthetic
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  RETURNING *
  `,
      [
        value.name, // $1
        value.description, // $2
        ownerId, // $3
        isPublicBoolean, // $4
        maxMembersForInsert, // $5
        value.is_remote ?? false, // $6
        value.is_remote ? null : (value.postal_code ?? null), // $7
        value.is_remote ? null : (value.city ?? null), // $8
        value.is_remote ? null : (value.state ?? null), // $9
        value.is_remote ? null : (value.district ?? null), // $10
        value.is_remote ? null : (value.country ?? null), // $11
        value.is_remote ? null : (value.latitude ?? null), // $12
        value.is_remote ? null : (value.longitude ?? null), // $13
        value.teamavatar_url ?? null, // $14
        isOwnerSynthetic, // $15
      ],
    );

    const team = teamResult.rows[0];

    await client.query(
      `
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ($1, $2, $3)
    `,
      [team.id, ownerId, "owner"],
    );

    if (value.tags && value.tags.length > 0) {
      const tagIdsToCheck = value.tags.map((tag) => tag.tag_id);
      const tagsExistResult = await client.query(`
        SELECT id FROM tags WHERE id IN (${tagIdsToCheck.join(",")})
      `);
      const existingTagIds = tagsExistResult.rows.map((row) => row.id);

      if (existingTagIds.length !== tagIdsToCheck.length) {
        console.error(
          "--> Invalid tag IDs:",
          tagIdsToCheck.filter((tagId) => !existingTagIds.includes(tagId)),
        );
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Invalid input data", // More specific message
          errors: ["One or more of the provided tag IDs do not exist."],
        });
      }

      const tagInserts = value.tags.map((tag) =>
        client.query(
          `
          INSERT INTO team_tags (team_id, tag_id)
          VALUES ($1, $2)
        `,
          [team.id, tag.tag_id],
        ),
      );
      await Promise.all(tagInserts);
    }

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Team created successfully",
      data: team,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("--> Database error during team creation:", error);
    res.status(500).json({
      success: false,
      message: "Database error while creating team",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  } finally {
    client.release();
  }
};

const updateTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Check if team exists and user is the owner OR admin
    const teamCheck = await db.pool.query(
      `
      SELECT t.*, tm.role
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE t.id = $1 
      AND tm.user_id = $2 
      AND (tm.role = 'owner' OR tm.role = 'admin')
      AND t.archived_at IS NULL
    `,
      [teamId, userId],
    );

    if (teamCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this team or team not found",
      });
    }

    // Get current team data to access old avatar URL
    const currentTeam = teamCheck.rows[0];
    const oldAvatarUrl = currentTeam.teamavatar_url;
    const oldAvatarFileId = currentTeam.teamavatar_file_id;

    // Create validation schema for update (similar to creation but all fields optional)
    const updateSchema = Joi.object({
      name: Joi.string().min(3).max(100),
      description: Joi.string().min(10).max(500),

      is_public: Joi.boolean(),

      max_members: Joi.alternatives().try(
        Joi.number().integer().min(2),
        Joi.valid(null),
      ),

      // LOCATION
      is_remote: Joi.boolean(),
      postal_code: Joi.string().allow(null, ""),
      city: Joi.string().allow(null, ""),
      state: Joi.string().allow(null, ""),
      district: Joi.string().allow(null, ""),
      country: Joi.string().allow(null, ""),

      status: Joi.string().valid("active", "inactive"),

      teamavatar_url: Joi.string().uri().allow(null, ""),
      teamavatar_file_id: Joi.string().allow(null, ""),

      tags: Joi.array().items(
        Joi.object({
          tag_id: Joi.number().integer().required(),
        }),
      ),
    });

    // Validate request body
    const { error, value } = updateSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        errors: error.details.map((detail) => detail.message),
      });
    }

    // Normalize location rules:
    // - If is_remote is true: clear location fields
    // - Convert empty strings to null so DB stores NULL instead of ""
    const isRemoteProvided = value.is_remote !== undefined;
    const isRemote = value.is_remote === true;

    const hasAnyLocationField =
      value.postal_code !== undefined ||
      value.city !== undefined ||
      value.state !== undefined ||
      value.district !== undefined ||
      value.country !== undefined;

    if (isRemoteProvided && isRemote) {
      value.postal_code = null;
      value.city = null;
      value.state = null;
      value.district = null;
      value.country = null;
      if (isRemoteProvided && isRemote) {
        delete value.postal_code;
        delete value.city;
        delete value.state;
        delete value.district;
        delete value.country;
      }
    } else if (!isRemoteProvided && hasAnyLocationField) {
      // optional: if user sets location fields we assume not remote
      value.is_remote = false;
    }

    // normalize empties to null
    if (value.postal_code === "") value.postal_code = null;
    if (value.city === "") value.city = null;
    if (value.state === "") value.state = null;
    if (value.district === "") value.district = null;
    if (value.country === "") value.country = null;
    if (value.teamavatar_file_id === "") value.teamavatar_file_id = null;

    // Geocode if location changed and not remote
    if (!isRemote && value.country) {
      const resolvedLocation = await resolveLocationData({
        postal_code: value.postal_code,
        city: value.city,
        state: value.state,
        district: value.district,
        country: value.country,
      });

      if (resolvedLocation) {
        value.postal_code = resolvedLocation.postal_code;
        value.city = resolvedLocation.city;
        value.state = resolvedLocation.state;
        value.district = resolvedLocation.district;
        value.country = resolvedLocation.country;
        value.latitude = resolvedLocation.latitude;
        value.longitude = resolvedLocation.longitude;
      } else {
        // Clear coordinates if geocoding fails
        value.latitude = null;
        value.longitude = null;
        value.district = null;
      }
    } else if (isRemote) {
      // Clear coordinates for remote teams
      value.latitude = null;
      value.longitude = null;
      value.district = null;
    }

    // Begin transaction
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      // Build dynamic update query
      const updateFields = [];
      const queryParams = [];
      let paramCounter = 1;

      // Handle team avatar URL with old image deletion
      if (value.teamavatar_url !== undefined) {
        updateFields.push(`teamavatar_url = $${paramCounter}`);
        queryParams.push(value.teamavatar_url);
        paramCounter++;

        updateFields.push(`teamavatar_file_id = $${paramCounter}`);
        queryParams.push(value.teamavatar_file_id ?? null);
        paramCounter++;

        // Delete old image from ImageKit if it exists and is different from the new one
        if (
          (oldAvatarUrl || oldAvatarFileId) &&
          oldAvatarUrl !== value.teamavatar_url
        ) {
          await deleteImageKitFile(oldAvatarUrl, oldAvatarFileId);
        }
      }

      if (value.name) {
        updateFields.push(`name = $${paramCounter}`);
        queryParams.push(value.name);
        paramCounter++;
      }

      if (value.description) {
        updateFields.push(`description = $${paramCounter}`);
        queryParams.push(value.description);
        paramCounter++;
      }

      if (value.is_public !== undefined) {
        const isPublicBoolean =
          value.is_public === true ||
          value.is_public === "true" ||
          value.is_public === 1;
        updateFields.push(`is_public = $${paramCounter}`);
        queryParams.push(isPublicBoolean);
        paramCounter++;
      }

      // Allow null to be saved (unlimited),
      // but only update when the field was actually sent.
      if (value.max_members !== undefined) {
        updateFields.push(`max_members = $${paramCounter}`);
        queryParams.push(value.max_members); // can be null or number
        paramCounter++;
      }

      // LOCATION FIELDS (single-pass, no duplicates)

      // is_remote
      if (value.is_remote !== undefined) {
        updateFields.push(`is_remote = $${paramCounter}`);
        queryParams.push(value.is_remote);
        paramCounter++;
      }

      // postal_code
      if (value.postal_code !== undefined) {
        updateFields.push(`postal_code = $${paramCounter}`);
        queryParams.push(value.postal_code); // already normalized to null above
        paramCounter++;
      }

      // city
      if (value.city !== undefined) {
        updateFields.push(`city = $${paramCounter}`);
        queryParams.push(value.city); // already normalized to null above
        paramCounter++;
      }

      // state
      if (value.state !== undefined) {
        updateFields.push(`state = $${paramCounter}`);
        queryParams.push(value.state); // already normalized to null above
        paramCounter++;
      }

      // district
      if (value.district !== undefined) {
        updateFields.push(`district = $${paramCounter}`);
        queryParams.push(value.district); // already normalized to null above
        paramCounter++;
      }

      // country
      if (value.country !== undefined) {
        updateFields.push(`country = $${paramCounter}`);
        queryParams.push(value.country); // already normalized to null above
        paramCounter++;
      }

      // latitude
      if (value.latitude !== undefined) {
        updateFields.push(`latitude = $${paramCounter}`);
        queryParams.push(value.latitude);
        paramCounter++;
      }

      // longitude
      if (value.longitude !== undefined) {
        updateFields.push(`longitude = $${paramCounter}`);
        queryParams.push(value.longitude);
        paramCounter++;
      }

      if (value.status) {
        updateFields.push(`status = $${paramCounter}`);
        queryParams.push(value.status);
        paramCounter++;
      }

      // Only update if there are fields to update
      if (updateFields.length > 0) {
        updateFields.push(`updated_at = NOW()`);

        queryParams.push(teamId); // Add teamId as the last parameter

        const updateQuery = `
          UPDATE teams 
          SET ${updateFields.join(", ")}
          WHERE id = $${paramCounter}
          RETURNING *
        `;

        await client.query(updateQuery, queryParams);
      }

      // Update tags if provided
      if (Array.isArray(value.tags)) {
        // Validate tag IDs only if there are any
        if (value.tags.length > 0) {
          const tagIdsToCheck = value.tags.map((tag) => tag.tag_id);
          const tagsExistResult = await client.query(`
      SELECT id FROM tags WHERE id IN (${tagIdsToCheck.join(",")})
    `);
          const existingTagIds = tagsExistResult.rows.map((row) => row.id);

          if (existingTagIds.length !== tagIdsToCheck.length) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Invalid input data",
              errors: ["One or more of the provided tag IDs do not exist."],
            });
          }
        }

        // Always delete existing tags first (covers the "remove all" case)
        await client.query(`DELETE FROM team_tags WHERE team_id = $1`, [
          teamId,
        ]);

        // Insert new tags only if there are any
        if (value.tags.length > 0) {
          const tagInserts = value.tags.map((tag) =>
            client.query(
              `INSERT INTO team_tags (team_id, tag_id) VALUES ($1, $2)`,
              [teamId, tag.tag_id],
            ),
          );
          await Promise.all(tagInserts);
        }
      }

      await client.query("COMMIT");

      // Fetch the updated team data to return
      const updatedTeamResult = await client.query(
        `SELECT id, name, description, is_public, max_members,
                owner_id, teamavatar_url, teamavatar_file_id, is_remote, is_synthetic,
                postal_code, city, state, district, country,
                created_at, updated_at
         FROM teams WHERE id = $1`,
        [teamId],
      );

      const { teamavatar_file_id, ...updatedTeam } = updatedTeamResult.rows[0];

      res.status(200).json({
        success: true,
        message: "Team updated successfully",
        data: updatedTeam,
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      console.error("Database error during team update:", dbError);
      res.status(500).json({
        success: false,
        message: "Database error while updating team",
        ...(process.env.NODE_ENV === "development" && { error: dbError.message }),
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Team update error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating team",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

const deleteTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Check if team exists and user is the owner
    const teamCheck = await db.pool.query(
      `
      SELECT t.*, tm.role
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE t.id = $1 
      AND tm.user_id = $2 
      AND tm.role = 'owner'
      AND t.archived_at IS NULL
    `,
      [teamId, userId],
    );

    if (teamCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this team or team not found",
      });
    }

    // Begin transaction
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      // Soft delete by setting archived_at
      await client.query(
        `
        UPDATE teams
        SET archived_at = NOW(), status = 'inactive'
        WHERE id = $1
      `,
        [teamId],
      );

      await client.query("COMMIT");

      // === CREATE NOTIFICATIONS FOR ALL TEAM MEMBERS ===
      try {
        const teamName = teamCheck.rows[0].name;

        // Get owner's name
        const ownerResult = await db.pool.query(
          `SELECT first_name, last_name, username FROM users WHERE id = $1`,
          [userId],
        );
        const owner = ownerResult.rows[0];
        const ownerName =
          owner.first_name && owner.last_name
            ? `${owner.first_name} ${owner.last_name}`
            : owner.username;

        // Get all team members (except owner)
        const membersResult = await db.pool.query(
          `SELECT user_id FROM team_members WHERE team_id = $1 AND user_id != $2`,
          [teamId, userId],
        );

        // Send ONE system message to the team chat (not DM)
        const deleteMessage = `🗑️ TEAM_DELETED: ${teamName} | ${ownerName}`;

        const deleteMessageResult = await db.pool.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
   VALUES ($1, $2, $3, NOW())
   RETURNING id, sender_id, team_id, content, sent_at`,
          [userId, teamId, deleteMessage],
        );
        await emitInsertedMessage(req, deleteMessageResult.rows[0]);

        // Remove all stale unread notifications for this team before notifying members
        await db.pool.query(
          `DELETE FROM notifications WHERE team_id = $1 AND type != 'team_deleted' AND read_at IS NULL`,
          [teamId],
        );

        // Send notification to each member (no DM needed)
        const io = req.app.get("io");
        for (const member of membersResult.rows) {
          // Create notification
          await createNotification({
            userId: member.user_id,
            type: "team_deleted",
            title: `${teamName} has been deleted`,
            message: `${ownerName} has deleted the team.`,
            referenceType: "message",
            referenceId: deleteMessageResult.rows[0]?.id || parseInt(teamId),
            teamId: parseInt(teamId),
            actorId: parseInt(userId),
          });

          // Emit socket event
          if (io) {
            io.to(`user:${member.user_id}`).emit("notification:new", {
              type: "team_deleted",
              teamId: parseInt(teamId),
            });
          }
        }
      } catch (notificationError) {
        console.error(
          "Error creating team deletion notifications:",
          notificationError,
        );
      }
      // === END NOTIFICATION ===

      res.status(200).json({
        success: true,
        message: "Team archived successfully",
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      console.error("Database error during team deletion:", dbError);
      res.status(500).json({
        success: false,
        message: "Database error while deleting team",
        ...(process.env.NODE_ENV === "development" && { error: dbError.message }),
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Team deletion error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting team",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

module.exports = {
  createTeam,
  updateTeam,
  deleteTeam,
  permanentlyDeleteTeam,
  checkAndCleanupArchivedTeam,
  deleteTeamAvatar,
};
