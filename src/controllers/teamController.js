const db = require("../config/database");
const Joi = require("joi");
const cloudinary = require("../config/cloudinary");
const {
  createNotification,
  notifyTeamMembers,
  notifyTeamAdmins,
} = require("./notificationController");

const extractCloudinaryPublicId = (url) => {
  if (!url || typeof url !== "string") return null;

  const match = url.match(/\/image\/upload\/(?:v\d+\/)?(.+)\.[a-z]+$/);
  return match ? match[1] : null;
};

const permanentlyDeleteTeam = async (teamId) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
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
    [teamId]
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
      Joi.valid(null) // null represents "unlimited"
    )
    .required()
    .messages({
      "any.required": "Maximum members is required",
    }),

  teamavatar_url: Joi.string().uri().allow(null, "").messages({
    "string.uri": "Team avatar URL must be a valid URL",
  }),

  tags: Joi.array()
    .items(
      Joi.object({
        tag_id: Joi.number().integer().required(),
      })
    )
    .default([]), // Default([]) so it's optional
});

const createTeam = async (req, res) => {
  const client = await db.pool.connect();
  try {
    console.log("--> Entering createTeam function");
    const ownerId = req.user.id;
    console.log("--> Received team creation request:", req.body);
    console.log("--> Owner ID:", ownerId);

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
    console.log("--> Joi validation successful");

    console.log(
      "--> After Joi validation, value.max_members:",
      value.max_members
    );

    // Decide what to insert into max_members
    const maxMembersForInsert =
      value.max_members === undefined ? null : value.max_members;

    await client.query("BEGIN");
    console.log("--> Transaction started");

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
    postal_code,
    teamavatar_url
  ) VALUES ($1, $2, $3, $4, $5, $6, $7) 
  RETURNING id, name, description, is_public, max_members, postal_code, teamavatar_url, created_at
`,
      [
        value.name,
        value.description,
        ownerId,
        isPublicBoolean,
        maxMembersForInsert,
        value.postal_code || null,
        value.teamavatar_url || null,
      ]
    );
    const team = teamResult.rows[0];
    console.log("--> Team inserted:", team);

    await client.query(
      `
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ($1, $2, $3)
    `,
      [team.id, ownerId, "owner"]
    );
    console.log("--> Owner added as member");

    if (value.tags && value.tags.length > 0) {
      const tagIdsToCheck = value.tags.map((tag) => tag.tag_id);
      console.log("--> Checking tag IDs:", tagIdsToCheck);
      const tagsExistResult = await client.query(`
        SELECT id FROM tags WHERE id IN (${tagIdsToCheck.join(",")})
      `);
      const existingTagIds = tagsExistResult.rows.map((row) => row.id);

      if (existingTagIds.length !== tagIdsToCheck.length) {
        console.error(
          "--> Invalid tag IDs:",
          tagIdsToCheck.filter((tagId) => !existingTagIds.includes(tagId))
        );
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Invalid input data", // More specific message
          errors: ["One or more of the provided tag IDs do not exist."],
        });
      }
      console.log("--> All tag IDs exist");

      const tagInserts = value.tags.map((tag) =>
        client.query(
          `
          INSERT INTO team_tags (team_id, tag_id)
          VALUES ($1, $2)
        `,
          [team.id, tag.tag_id]
        )
      );
      await Promise.all(tagInserts);
      console.log("--> Tags inserted");
    }

    await client.query("COMMIT");
    console.log("--> Transaction committed");

    res.status(201).json({
      success: true,
      message: "Team created successfully",
      data: team,
    });
    console.log("--> Successful response sent");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("--> Database error during team creation:", error); // More specific message
    res.status(500).json({
      success: false,
      message: "Database error while creating team", // More specific message
      errorDetails: error.message,
      fullError: error,
    });
  } finally {
    client.release();
    console.log("--> Client released");
  }
  console.log("--> Exiting createTeam function");
};

const getAllTeams = async (req, res) => {
  try {
    // Implement pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Query database with pagination
    const teamsResult = await db.pool.query(
      `
      SELECT t.*, 
             COUNT(tm.id) AS current_members_count
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      WHERE t.archived_at IS NULL
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT $1 OFFSET $2
    `,
      [limit, offset]
    );

    // Get total count for pagination metadata
    const countResult = await db.pool.query(`
      SELECT COUNT(*) FROM teams WHERE archived_at IS NULL
    `);

    const totalTeams = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalTeams / limit);

    res.status(200).json({
      success: true,
      data: teamsResult.rows,
      pagination: {
        total: totalTeams,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Database error while fetching teams:", error); // More specific message
    res.status(500).json({
      success: false,
      message: "Database error while fetching teams", // More specific message
      error: error.message,
    });
  }
};

const getTeamById = async (req, res) => {
  try {
    const teamId = req.params.id;

    // Fetch team details with member count
    const teamResult = await db.pool.query(
      `
      SELECT t.*, 
             COALESCE(COUNT(DISTINCT tm.user_id), 0) as current_members_count
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      WHERE t.id = $1
      GROUP BY t.id
      `,
      [teamId]
    );

    if (teamResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const team = teamResult.rows[0];

    // Get team members with their details
    const membersResult = await db.pool.query(
      `
  SELECT tm.user_id, tm.role, tm.joined_at, 
         u.username, u.email, u.avatar_url, 
         u.first_name, u.last_name, u.is_public,
         u.postal_code
  FROM team_members tm
  JOIN users u ON tm.user_id = u.id
  WHERE tm.team_id = $1
  ORDER BY 
    CASE tm.role 
      WHEN 'owner' THEN 1 
      WHEN 'admin' THEN 2 
      ELSE 3 
    END,
    tm.joined_at ASC
  `,
      [teamId]
    );

    // Get team tags
    const tagsResult = await db.pool.query(
      `
      SELECT tt.tag_id, t.name, t.category, t.supercategory
      FROM team_tags tt
      JOIN tags t ON tt.tag_id = t.id
      WHERE tt.team_id = $1
      ORDER BY t.supercategory, t.category, t.name
      `,
      [teamId]
    );

    // Construct response with proper member count
    team.members = membersResult.rows;
    team.tags = tagsResult.rows;

    // Ensure boolean values
    team.is_public = team.is_public === true;

    console.log(`Team ${teamId} details:`, {
      id: team.id,
      name: team.name,
      current_members_count: team.current_members_count,
      max_members: team.max_members,
      members_length: team.members.length,
      is_public: team.is_public,
    });

    res.status(200).json({
      success: true,
      data: team,
    });
  } catch (error) {
    console.error("Database error while fetching team:", error);
    res.status(500).json({
      success: false,
      message: "Database error while fetching team details",
      error: error.message,
    });
  }
};

const getUserTeams = async (req, res) => {
  try {
    // Use the authenticated user's ID from the token
    const userId = req.user.id;

    const teamsResult = await db.pool.query(
      `
      SELECT t.id, 
             t.name, 
             t.description, 
             t.teamavatar_url, 
             t.max_members, 
             t.is_public, 
             t.owner_id, 
             t.created_at, 
             t.updated_at, 
             t.postal_code,
             COALESCE(COUNT(DISTINCT tm.user_id), 0) AS current_members_count,
             tmr.role as user_role
      FROM teams t
      JOIN team_members tmr ON t.id = tmr.team_id AND tmr.user_id = $1
      LEFT JOIN team_members tm ON t.id = tm.team_id
      WHERE t.archived_at IS NULL
      GROUP BY t.id, tmr.role
      ORDER BY t.created_at DESC
      `,
      [userId]
    );

    // Ensure proper boolean values
    const teamsWithFixedData = teamsResult.rows.map((team) => ({
      ...team,
      is_public: team.is_public === true,
    }));

    res.status(200).json({
      success: true,
      data: teamsWithFixedData,
    });
  } catch (error) {
    console.error("Database error while fetching user teams:", error);
    res.status(500).json({
      success: false,
      message: "Database error while fetching user teams",
      error: error.message,
    });
  }
};

const getUserRoleInTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.params.userId;

    const roleResult = await db.pool.query(
      `
      SELECT role 
      FROM team_members 
      WHERE team_id = $1 AND user_id = $2
      `,
      [teamId, userId]
    );

    // ✅ User is NOT a member (normal case, not an error)
    if (roleResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        isMember: false,
        role: null,
      });
    }

    // ✅ User IS a member
    return res.status(200).json({
      success: true,
      isMember: true,
      role: roleResult.rows[0].role,
    });
  } catch (error) {
    console.error("Error fetching user role:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching user role",
      error: error.message,
    });
  }
};

const getUserPendingApplications = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's pending applications with team details
    const applicationsResult = await db.pool.query(
      `SELECT 
    ta.id, ta.team_id, ta.message, ta.status, ta.created_at,
    t.name, t.description, t.teamavatar_url, t.max_members, t.is_public,
    (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as current_members_count,
    owner.id as owner_id,
    owner.username as owner_username,
    owner.first_name as owner_first_name,
    owner.last_name as owner_last_name,
    owner.avatar_url as owner_avatar_url
   FROM team_applications ta
   JOIN teams t ON ta.team_id = t.id
   JOIN team_members tm ON t.id = tm.team_id AND tm.role = 'owner'
   JOIN users owner ON tm.user_id = owner.id
   WHERE ta.applicant_id = $1 AND ta.status = 'pending'
   ORDER BY ta.created_at DESC`,
      [userId]
    );

    const applications = applicationsResult.rows.map((row) => ({
      id: row.id,
      message: row.message,
      status: row.status,
      created_at: row.created_at,
      team: {
        id: row.team_id,
        name: row.name,
        description: row.description,
        teamavatar_url: row.teamavatar_url,
        max_members: row.max_members,
        is_public: row.is_public === true,
        current_members_count: parseInt(row.current_members_count),
      },
      // Owner (receiver) info
      owner: {
        id: row.owner_id,
        username: row.owner_username,
        first_name: row.owner_first_name,
        last_name: row.owner_last_name,
        avatar_url: row.owner_avatar_url,
      },
    }));

    res.status(200).json({
      success: true,
      data: applications,
    });
  } catch (error) {
    console.error("Error fetching user pending applications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching applications",
      error: error.message,
    });
  }
};

const cancelApplication = async (req, res) => {
  try {
    const applicationId = req.params.applicationId;
    const userId = req.user.id;

    // Get application with full details
    const applicationResult = await db.pool.query(
      `SELECT ta.*, t.name as team_name,
              u.first_name as applicant_first_name,
              u.last_name as applicant_last_name,
              u.username as applicant_username
       FROM team_applications ta
       JOIN teams t ON ta.team_id = t.id
       JOIN users u ON ta.applicant_id = u.id
       WHERE ta.id = $1 AND ta.applicant_id = $2 AND ta.status = 'pending'`,
      [applicationId, userId]
    );

    if (applicationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Application not found or cannot be canceled",
      });
    }

    const application = applicationResult.rows[0];

    // Get applicant's name
    const applicantName =
      application.applicant_first_name && application.applicant_last_name
        ? `${application.applicant_first_name} ${application.applicant_last_name}`
        : application.applicant_username;

    // Delete the application
    await db.pool.query(`DELETE FROM team_applications WHERE id = $1`, [
      applicationId,
    ]);

    // Get team admins and owners to notify
    const adminsResult = await db.pool.query(
      `SELECT tm.user_id, u.first_name, u.last_name, u.username
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1 AND tm.role IN ('owner', 'admin')`,
      [application.team_id]
    );

    // Send system message and notification to each admin
    for (const admin of adminsResult.rows) {
      const adminName =
        admin.first_name && admin.last_name
          ? `${admin.first_name} ${admin.last_name}`
          : admin.username;

      // System message format
      // Parseable + clickable tokens
      const teamToken = `${application.team_id}:${application.team_name}`;
      const applicantToken = `${userId}:${applicantName}`;
      const adminToken = `${admin.user_id}:${adminName}`;

      const cancelSystemMessage = `🚫 APPLICATION_CANCELLED: ${teamToken} | ${applicantToken} | ${adminToken}`;

      await db.pool.query(
        `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
   VALUES ($1, $2, $3, NOW())`,
        [userId, admin.user_id, cancelSystemMessage]
      );

      // Create notification for admin
      try {
        await createNotification({
          userId: admin.user_id,
          type: "application_cancelled",
          title: `${applicantName} withdrew their application for ${application.team_name}`,
          message: null,
          referenceType: "team_application",
          referenceId: parseInt(applicationId),
          teamId: application.team_id,
          actorId: userId,
        });

        // Emit socket event
        const io = req.app.get("io");
        if (io) {
          io.to(`user:${admin.user_id}`).emit("notification:new", {
            type: "application_cancelled",
            teamId: application.team_id,
          });
        }
      } catch (notificationError) {
        console.error(
          "Error creating application cancel notification:",
          notificationError
        );
      }
    }

    res.status(200).json({
      success: true,
      message: "Application canceled successfully",
    });
  } catch (error) {
    console.error("Error canceling application:", error);
    res.status(500).json({
      success: false,
      message: "Error canceling application",
      error: error.message,
    });
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
      [teamId, userId]
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

    // Create validation schema for update (similar to creation but all fields optional)
    const updateSchema = Joi.object({
      name: Joi.string().min(3).max(100),
      description: Joi.string().min(10).max(500),
      is_public: Joi.boolean(),
      max_members: Joi.alternatives().try(
        Joi.number().integer().min(2),
        Joi.valid(null) // null = "unlimited"
      ),
      postal_code: Joi.string(),
      status: Joi.string().valid("active", "inactive"),
      teamavatar_url: Joi.string().uri().allow(null, ""),
      tags: Joi.array().items(
        Joi.object({
          tag_id: Joi.number().integer().required(),
        })
      ),
    });

    // NOTE: This nested function is unrelated to max_members;
    // leaving it as-is from your original code.
    const updateMemberRole = async (req, res) => {
      try {
        const teamId = req.params.teamId;
        const memberId = req.params.memberId;
        const userId = req.user.id;

        // ✅ DEBUG: Log what we're receiving
        console.log("=== ROLE UPDATE DEBUG ===");
        console.log("Request body:", req.body);
        console.log("Request body type:", typeof req.body);
        console.log("Request body keys:", Object.keys(req.body));

        // Accept both camelCase and snake_case
        const { newRole, new_role } = req.body;
        const roleToUpdate = newRole || new_role;

        console.log("Extracted values:");
        console.log("- newRole:", newRole);
        console.log("- new_role:", new_role);
        console.log("- roleToUpdate:", roleToUpdate);
        console.log("- roleToUpdate type:", typeof roleToUpdate);
        console.log("=========================");

        // Validate role
        const validRoles = ["member", "admin"];
        if (!validRoles.includes(roleToUpdate)) {
          console.log("❌ Role validation failed for:", roleToUpdate);
          return res.status(400).json({
            success: false,
            message: "Invalid role. Must be 'member' or 'admin'",
            debug: {
              received: roleToUpdate,
              expectedOneOf: validRoles,
              receivedType: typeof roleToUpdate,
            },
          });
        }

        console.log("✅ Role validation passed for:", roleToUpdate);

        // Check if the user making the request is authorized (owner or admin)
        const authCheck = await db.pool.query(
          `
      SELECT tm.role 
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.team_id = $1 
      AND tm.user_id = $2
      AND (tm.role = 'owner' OR tm.role = 'admin')
      AND t.archived_at IS NULL
    `,
          [teamId, userId]
        );

        if (authCheck.rows.length === 0) {
          return res.status(403).json({
            success: false,
            message: "Not authorized to change member roles in this team",
          });
        }

        const userRole = authCheck.rows[0].role;

        // Check if target member exists and get their current role
        const memberCheck = await db.pool.query(
          `
      SELECT role FROM team_members 
      WHERE team_id = $1 AND user_id = $2
    `,
          [teamId, memberId]
        );

        if (memberCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Member not found in this team",
          });
        }

        const memberCurrentRole = memberCheck.rows[0].role;

        // Only owners can change admin roles
        if (memberCurrentRole === "admin" && userRole !== "owner") {
          return res.status(403).json({
            success: false,
            message: "Only team owners can change admin roles",
          });
        }

        // Only owners can promote to admin
        if (roleToUpdate === "admin" && userRole !== "owner") {
          return res.status(403).json({
            success: false,
            message: "Only team owners can promote members to admin",
          });
        }

        // Can't change owner role
        if (memberCurrentRole === "owner") {
          return res.status(403).json({
            success: false,
            message: "Cannot change owner role",
          });
        }

        // Update member role
        const client = await db.pool.connect();

        try {
          await client.query("BEGIN");

          // Delete all team chat messages first (before soft deleting team)
          await client.query(`DELETE FROM messages WHERE team_id = $1`, [
            teamId,
          ]);

          // Soft delete by setting archived_at
          await client.query(
            `
        UPDATE teams
        SET archived_at = NOW(), status = 'inactive'
        WHERE id = $1
      `,
            [teamId]
          );

          await client.query("COMMIT");

          // === CREATE NOTIFICATION FOR AFFECTED MEMBER ===
          try {
            // Get team name
            const teamResult = await db.pool.query(
              `SELECT name FROM teams WHERE id = $1`,
              [teamId]
            );
            const teamName = teamResult.rows[0]?.name || "the team";

            // Get changer's name (the admin/owner who made the change)
            const changerResult = await db.pool.query(
              `SELECT first_name, last_name, username FROM users WHERE id = $1`,
              [userId]
            );
            const changer = changerResult.rows[0];
            const changerName =
              changer.first_name && changer.last_name
                ? `${changer.first_name} ${changer.last_name}`
                : changer.username;

            // Get affected member's name
            const memberResult = await db.pool.query(
              `SELECT first_name, last_name, username FROM users WHERE id = $1`,
              [memberId]
            );
            const member = memberResult.rows[0];
            const memberName =
              member.first_name && member.last_name
                ? `${member.first_name} ${member.last_name}`
                : member.username;

            // Determine if promoted or demoted
            const action = roleToUpdate === "admin" ? "promoted" : "demoted";

            // Send system message to affected member via DM
            const teamToken = `${teamId}:${teamName}`;

            const roleChangeMessage = `🔄 ROLE_CHANGED: ${teamToken} | ${userId}:${changerName} | ${memberId}:${memberName} | ${memberCurrentRole} | ${roleToUpdate}`;

            await db.pool.query(
              `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
               VALUES ($1, $2, $3, NOW())`,
              [userId, memberId, roleChangeMessage]
            );

            // Create notification for affected member
            await createNotification({
              userId: parseInt(memberId),
              type: "role_changed",
              title: `You were ${action} to ${roleToUpdate} in ${teamName}`,
              message: null,
              referenceType: "team_member",
              referenceId: parseInt(teamId),
              teamId: parseInt(teamId),
              actorId: parseInt(userId),
            });

            // Emit socket event to affected member
            const io = req.app.get("io");
            if (io) {
              io.to(`user:${memberId}`).emit("notification:new", {
                type: "role_changed",
                teamId: parseInt(teamId),
              });
            }
          } catch (notificationError) {
            console.error(
              "Error creating role change notification:",
              notificationError
            );
          }
          // === END NOTIFICATION ===

          res.status(200).json({
            success: true,
            message: `Member role updated to ${roleToUpdate} successfully`,
          });
        } catch (dbError) {
          await client.query("ROLLBACK");
          console.error("Database error while updating member role:", dbError);
          res.status(500).json({
            success: false,
            message: "Database error while updating member role",
            errorDetails: dbError.message,
          });
        } finally {
          client.release();
        }
      } catch (error) {
        console.error("Update member role error:", error);
        res.status(500).json({
          success: false,
          message: "Error updating member role",
          error: error.message,
        });
      }
    };

    // Validate request body
    const { error, value } = updateSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        errors: error.details.map((detail) => detail.message),
      });
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

        // Delete old image from Cloudinary if it exists and is different from new one
        if (
          oldAvatarUrl &&
          oldAvatarUrl !== value.teamavatar_url &&
          oldAvatarUrl.includes("cloudinary.com")
        ) {
          try {
            const publicId = extractCloudinaryPublicId(oldAvatarUrl);
            if (publicId) {
              console.log(
                `Attempting to delete old team avatar from Cloudinary: ${publicId}`
              );
              const deleteResult = await cloudinary.uploader.destroy(publicId);
              console.log("Cloudinary deletion result:", deleteResult);
            }
          } catch (cloudinaryError) {
            console.error(
              "Error deleting old team avatar from Cloudinary:",
              cloudinaryError
            );
            // Don't fail the update if Cloudinary deletion fails
          }
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

      // 🔧 IMPORTANT FIX: allow null to be saved (unlimited),
      // but only update when the field was actually sent.
      if (value.max_members !== undefined) {
        updateFields.push(`max_members = $${paramCounter}`);
        queryParams.push(value.max_members); // can be null or number
        paramCounter++;
      }

      if (value.postal_code) {
        updateFields.push(`postal_code = $${paramCounter}`);
        queryParams.push(value.postal_code);
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
      if (value.tags && value.tags.length > 0) {
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

        // Remove existing tags
        await client.query(
          `
          DELETE FROM team_tags WHERE team_id = $1
        `,
          [teamId]
        );

        // Add new tags
        const tagInserts = value.tags.map((tag) =>
          client.query(
            `
            INSERT INTO team_tags (team_id, tag_id)
            VALUES ($1, $2)
          `,
            [teamId, tag.tag_id]
          )
        );

        await Promise.all(tagInserts);
      }

      await client.query("COMMIT");

      // Fetch the updated team data to return
      const updatedTeamResult = await client.query(
        `
  SELECT * FROM teams WHERE id = $1
`,
        [teamId]
      );

      const updatedTeam = updatedTeamResult.rows[0];

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
        errorDetails: dbError.message,
        fullError: dbError,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Team update error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating team",
      error: error.message,
    });
  }
};

const getTeamApplications = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Check if user is the team owner or admin
    const authCheck = await db.pool.query(
      `SELECT tm.role FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       WHERE tm.team_id = $1 AND tm.user_id = $2 
       AND (tm.role = 'owner' OR tm.role = 'admin')
       AND t.archived_at IS NULL`,
      [teamId, userId]
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view applications for this team",
      });
    }

    // Get pending applications with applicant details
    const applicationsResult = await db.pool.query(
      `SELECT 
        ta.id, ta.message, ta.status, ta.created_at,
        u.id as applicant_id, u.username, u.first_name, u.last_name, 
        u.bio, u.avatar_url, u.postal_code
       FROM team_applications ta
       JOIN users u ON ta.applicant_id = u.id
       WHERE ta.team_id = $1 AND ta.status = 'pending'
       ORDER BY ta.created_at ASC`,
      [teamId]
    );

    const applications = applicationsResult.rows.map((row) => ({
      id: row.id,
      message: row.message,
      status: row.status,
      created_at: row.created_at,
      applicant: {
        id: row.applicant_id,
        username: row.username,
        first_name: row.first_name,
        last_name: row.last_name,
        bio: row.bio,
        avatar_url: row.avatar_url,
        postal_code: row.postal_code,
      },
    }));

    res.status(200).json({
      success: true,
      data: applications,
    });
  } catch (error) {
    console.error("Error fetching team applications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team applications",
      error: error.message,
    });
  }
};

const handleTeamApplication = async (req, res) => {
  try {
    const applicationId = req.params.applicationId;
    const { action, response } = req.body; // action: 'approve' or 'decline'
    const userId = req.user.id;

    // Get application details
    const applicationResult = await db.pool.query(
      `SELECT ta.*, t.owner_id, t.max_members, t.name as team_name, tm.role,
          applicant.first_name as applicant_first_name, 
          applicant.last_name as applicant_last_name,
          applicant.username as applicant_username
   FROM team_applications ta
   JOIN teams t ON ta.team_id = t.id
   JOIN users applicant ON ta.applicant_id = applicant.id
   LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = $1
   WHERE ta.id = $2`,
      [userId, applicationId]
    );

    if (applicationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const application = applicationResult.rows[0];

    // Check authorization
    if (application.owner_id !== userId && application.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to handle this application",
      });
    }

    // Get approver's name
    const approverResult = await db.pool.query(
      `SELECT first_name, last_name, username FROM users WHERE id = $1`,
      [userId]
    );
    const approver = approverResult.rows[0];

    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      if (action === "approve") {
        // Check if team is full
        const memberCountResult = await client.query(
          `SELECT COUNT(*) as count FROM team_members WHERE team_id = $1`,
          [application.team_id]
        );

        if (
          application.max_members !== null &&
          parseInt(memberCountResult.rows[0].count) >= application.max_members
        ) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: "Team is already at maximum capacity",
          });
        }

        // Add user to team
        await client.query(
          `INSERT INTO team_members (team_id, user_id, role, joined_at)
   VALUES ($1, $2, 'member', NOW())`,
          [application.team_id, application.applicant_id]
        );

        // Clean up any pending invitations for this user to this team
        await client.query(
          `UPDATE team_invitations 
   SET status = 'accepted', responded_at = NOW()
   WHERE team_id = $1 AND invitee_id = $2 AND status = 'pending'`,
          [application.team_id, application.applicant_id]
        );

        // Update application status
        await client.query(
          `UPDATE team_applications 
   SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1
   WHERE id = $2`,
          [userId, applicationId]
        );

        // Add system message to team chat for approved application
        const applicantName =
          application.applicant_first_name && application.applicant_last_name
            ? `${application.applicant_first_name} ${application.applicant_last_name}`
            : application.applicant_username;

        const approverName =
          approver.first_name && approver.last_name
            ? `${approver.first_name} ${approver.last_name}`
            : approver.username;

        const systemMessage = `🎉 ${applicantName} has applied successfully to your team and has been added as a team member by ${approverName}. Say hello to them!`;

        await client.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [application.applicant_id, application.team_id, systemMessage]
        );

        // Include whether there's a personal message
        const hasPersonalMessage =
          response && response.trim() ? "true" : "false";

        // System message format includes all info for both perspectives
        const teamToken = `${application.team_id}:${application.team_name}`;
        const approverToken = `${userId}:${approverName}`;
        const applicantToken = `${application.applicant_id}:${applicantName}`;

        const approvalSystemMessage = `✅ APPLICATION_APPROVED: ${teamToken} | ${approverToken} | ${applicantToken} | ${hasPersonalMessage}`;

        await client.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [userId, application.applicant_id, approvalSystemMessage]
        );

        // If there's a personal message, send it as a separate regular message
        if (response && response.trim()) {
          await client.query(
            `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())`,
            [userId, application.applicant_id, response.trim()]
          );
        }

        // === CREATE NOTIFICATIONS ===
        try {
          // Notify the applicant that they were approved
          await createNotification({
            userId: application.applicant_id,
            type: "application_approved",
            title: `Your application to ${application.team_name} was approved!`,
            message: response || "Welcome to the team!",
            referenceType: "team_application",
            referenceId: parseInt(applicationId),
            teamId: application.team_id,
            actorId: userId,
          });

          // Notify other team members about the new member
          await notifyTeamMembers({
            teamId: application.team_id,
            excludeUserId: application.applicant_id,
            type: "member_joined",
            title: `${applicantName} joined ${application.team_name}`,
            referenceType: "team_member",
            referenceId: application.applicant_id,
            actorId: application.applicant_id,
          });

          // Emit socket events
          const io = req.app.get("io");
          if (io) {
            io.to(`user:${application.applicant_id}`).emit("notification:new", {
              type: "application_approved",
              teamId: application.team_id,
            });
            io.to(`team:${application.team_id}`).emit("notification:new", {
              type: "member_joined",
              teamId: application.team_id,
            });
          }
        } catch (notificationError) {
          console.error(
            "Error creating approval notification:",
            notificationError
          );
        }
        // === END NOTIFICATION ===
      } else if (action === "decline") {
        // Get approver's name for the decline message
        const approverName =
          approver.first_name && approver.last_name
            ? `${approver.first_name} ${approver.last_name}`
            : approver.username;

        // Update application status
        await client.query(
          `UPDATE team_applications 
           SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1
           WHERE id = $2`,
          [userId, applicationId]
        );

        // Get applicant's name for the message
        const applicantName =
          application.applicant_first_name && application.applicant_last_name
            ? `${application.applicant_first_name} ${application.applicant_last_name}`
            : application.applicant_username;

        // Include whether there's a personal message
        const hasPersonalMessage =
          response && response.trim() ? "true" : "false";

        // System message format includes all info for both perspectives
        const teamToken = `${application.team_id}:${application.team_name}`;
        const approverToken = `${userId}:${approverName}`;
        const applicantToken = `${application.applicant_id}:${applicantName}`;

        const declineSystemMessage = `🚫 APPLICATION_DECLINED: ${teamToken} | ${approverToken} | ${applicantToken} | ${hasPersonalMessage}`;

        await client.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [userId, application.applicant_id, declineSystemMessage]
        );

        // If there's a personal message, send it as a separate regular message
        if (response && response.trim()) {
          await client.query(
            `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())`,
            [userId, application.applicant_id, response.trim()]
          );
        }
        // === CREATE NOTIFICATION FOR REJECTED APPLICANT ===
        try {
          await createNotification({
            userId: application.applicant_id,
            type: "application_rejected",
            title: `Your application to ${application.team_name} was declined`,
            message: response || null,
            referenceType: "team_application",
            referenceId: parseInt(applicationId),
            teamId: application.team_id,
            actorId: userId,
          });

          // Emit socket event
          const io = req.app.get("io");
          if (io) {
            io.to(`user:${application.applicant_id}`).emit("notification:new", {
              type: "application_rejected",
              teamId: application.team_id,
            });
          }
        } catch (notificationError) {
          console.error(
            "Error creating rejection notification:",
            notificationError
          );
        }

        // === END NOTIFICATION ===
      }

      // TODO: Send notification/message to applicant with response
      // This would involve creating a message in your messages table

      await client.query("COMMIT");

      res.status(200).json({
        success: true,
        message: `Application ${action}d successfully`,
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error handling team application:", error);
    res.status(500).json({
      success: false,
      message: "Error handling application",
      error: error.message,
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
      [teamId, userId]
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
        [teamId]
      );

      await client.query("COMMIT");

      // === CREATE NOTIFICATIONS FOR ALL TEAM MEMBERS ===
      try {
        const teamName = teamCheck.rows[0].name;

        // Get owner's name
        const ownerResult = await db.pool.query(
          `SELECT first_name, last_name, username FROM users WHERE id = $1`,
          [userId]
        );
        const owner = ownerResult.rows[0];
        const ownerName =
          owner.first_name && owner.last_name
            ? `${owner.first_name} ${owner.last_name}`
            : owner.username;

        // Get all team members (except owner)
        const membersResult = await db.pool.query(
          `SELECT user_id FROM team_members WHERE team_id = $1 AND user_id != $2`,
          [teamId, userId]
        );

        // Send ONE system message to the team chat (not DM)
        const deleteMessage = `🗑️ TEAM_DELETED: ${teamName} | ${ownerName}`;

        await db.pool.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
   VALUES ($1, $2, $3, NOW())`,
          [userId, teamId, deleteMessage]
        );

        // Send notification to each member (no DM needed)
        for (const member of membersResult.rows) {
          // Create notification
          await createNotification({
            userId: member.user_id,
            type: "team_deleted",
            title: `${teamName} has been deleted`,
            message: `${ownerName} has deleted the team.`,
            referenceType: "team",
            referenceId: parseInt(teamId),
            teamId: parseInt(teamId),
            actorId: parseInt(userId),
          });

          // Emit socket event
          const io = req.app.get("io");
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
          notificationError
        );
      }
      // === END NOTIFICATION ===

      res.status(200).json({
        success: true,
        message: "Team archived successfully",
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      console.error("Database error during team deletion:", dbError); // More specific message
      res.status(500).json({
        success: false,
        message: "Database error while deleting team", // More specific message
        errorDetails: dbError.message,
        fullError: dbError,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Team deletion error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting team",
      error: error.message,
    });
  }
};

const applyToJoinTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    const applicantId = req.user.id;
    const { message, isDraft = false } = req.body;

    // Validation
    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Application message is required",
      });
    }

    if (message.trim().length > 500) {
      return res.status(400).json({
        success: false,
        message: "Message cannot exceed 500 characters",
      });
    }

    // Check if team exists and is active
    const teamCheck = await db.pool.query(
      `SELECT id, name, owner_id, max_members FROM teams 
       WHERE id = $1 AND archived_at IS NULL`,
      [teamId]
    );

    if (teamCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const team = teamCheck.rows[0];

    // Check if user is already a member
    const memberCheck = await db.pool.query(
      `SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, applicantId]
    );

    if (memberCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "You are already a member of this team",
      });
    }

    // Check if team is full
    const memberCount = await db.pool.query(
      `SELECT COUNT(*) as count FROM team_members WHERE team_id = $1`,
      [teamId]
    );

    if (
      team.max_members !== null &&
      parseInt(memberCount.rows[0].count) >= team.max_members
    ) {
      return res.status(400).json({
        success: false,
        message: "Team is already at maximum capacity",
      });
    }

    // Check if user already has a pending application
    const existingApplicationCheck = await db.pool.query(
      `SELECT id FROM team_applications 
       WHERE team_id = $1 AND applicant_id = $2 AND status = 'pending'`,
      [teamId, applicantId]
    );

    if (existingApplicationCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "You already have a pending application for this team",
      });
    }

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");

      // Insert or update application
      const applicationResult = await client.query(
        `INSERT INTO team_applications (team_id, applicant_id, message, status, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (team_id, applicant_id) 
         DO UPDATE SET message = $3, status = $4, updated_at = NOW()
         RETURNING id`,
        [teamId, applicantId, message.trim(), isDraft ? "draft" : "pending"]
      );

      await client.query("COMMIT");

      // === CREATE NOTIFICATION FOR TEAM ADMINS (only for submitted applications, not drafts) ===
      if (!isDraft) {
        try {
          // Get applicant's name
          const applicantResult = await db.pool.query(
            `SELECT first_name, last_name, username FROM users WHERE id = $1`,
            [applicantId]
          );
          const applicant = applicantResult.rows[0];
          const applicantName =
            applicant.first_name && applicant.last_name
              ? `${applicant.first_name} ${applicant.last_name}`
              : applicant.username;

          await notifyTeamAdmins({
            teamId: parseInt(teamId),
            type: "application_received",
            title: `${applicantName} applied to join ${team.name}`,
            message: message || null,
            referenceType: "team_application",
            referenceId: applicationResult.rows[0].id,
            actorId: applicantId,
          });

          // Emit socket events to team admins
          const io = req.app.get("io");
          if (io) {
            io.to(`team:${teamId}`).emit("notification:new", {
              type: "application_received",
              teamId: parseInt(teamId),
            });
          }
        } catch (notificationError) {
          console.error(
            "Error creating application notification:",
            notificationError
          );
        }
      }
      // === END NOTIFICATION ===

      res.status(201).json({
        success: true,
        message: isDraft
          ? "Application draft saved successfully"
          : "Application sent successfully",
        data: {
          applicationId: applicationResult.rows[0].id,
          status: isDraft ? "draft" : "pending",
        },
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Apply to join team error:", error);
    res.status(500).json({
      success: false,
      message: "Error processing application",
      error: error.message,
    });
  }
};

const addTeamMember = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Validate request body
    const schema = Joi.object({
      memberId: Joi.number().required(),
      role: Joi.string().valid("member", "admin").default("member"),
    });

    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data", // More specific message
        errors: error.details.map((detail) => detail.message),
      });
    }

    const newMemberId = value.memberId;
    const role = value.role;

    // First check if the user is trying to remove themselves from an archived team
    const teamStatusCheck = await db.pool.query(
      `SELECT archived_at FROM teams WHERE id = $1`,
      [teamId]
    );

    const isArchivedTeam = teamStatusCheck.rows[0]?.archived_at !== null;
    const isSelfRemoval = userId == memberId;

    // For archived teams, only allow self-removal
    if (isArchivedTeam) {
      if (!isSelfRemoval) {
        return res.status(403).json({
          success: false,
          message: "Cannot remove other members from an archived team",
        });
      }

      // Verify user is actually a member
      const memberCheck = await db.pool.query(
        `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, memberId]
      );

      if (memberCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this team",
        });
      }

      // Skip the rest of the authorization logic for archived team self-removal
      // Just delete the membership
      await db.pool.query(
        `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, memberId]
      );

      return res.status(200).json({
        success: true,
        message: "Successfully left the archived team",
      });
    }

    // Original authorization check for non-archived teams
    const authCheck = await db.pool.query(
      `
  SELECT tm.role 
  FROM team_members tm
  JOIN teams t ON tm.team_id = t.id
  WHERE tm.team_id = $1 
  AND tm.user_id = $2
  AND t.archived_at IS NULL
`,
      [teamId, userId]
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to add members to this team",
      });
    }

    // Check if team exists and isn't full
    const teamCheck = await db.pool.query(
      `
      SELECT t.max_members, COUNT(tm.id) AS current_members
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      WHERE t.id = $1 AND t.archived_at IS NULL
      GROUP BY t.id, t.max_members
    `,
      [teamId]
    );

    if (teamCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const maxMembers = teamCheck.rows[0].max_members;
    if (
      maxMembers !== null &&
      teamCheck.rows[0].current_members >= maxMembers
    ) {
      return res.status(400).json({
        success: false,
        message: "Team is already at maximum capacity",
      });
    }

    // Check if user exists
    const userCheck = await db.pool.query(
      `
      SELECT id FROM users WHERE id = $1
    `,
      [newMemberId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user is already a member
    const memberCheck = await db.pool.query(
      `
      SELECT id FROM team_members 
      WHERE team_id = $1 AND user_id = $2
    `,
      [teamId, newMemberId]
    );

    if (memberCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User is already a member of this team",
      });
    }

    // Add member
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
        INSERT INTO team_members (team_id, user_id, role)
        VALUES ($1, $2, $3)
      `,
        [teamId, newMemberId, role]
      );

      await client.query("COMMIT");

      res.status(200).json({
        success: true,
        message: "Member added successfully",
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      console.error("Database error while adding member:", dbError); // More specific message
      res.status(500).json({
        success: false,
        message: "Database error while adding team member", // More specific message
        errorDetails: dbError.message,
        fullError: dbError,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Add team member error:", error);
    res.status(500).json({
      success: false,
      message: "Error adding team member",
      error: error.message,
    });
  }
};

const removeTeamMember = async (req, res) => {
  try {
    const teamId = req.params.id;
    const memberId = req.params.userId;
    const userId = req.user.id;

    // === Handle archived team self-removal ===
    const teamStatusCheck = await db.pool.query(
      `SELECT archived_at FROM teams WHERE id = $1`,
      [teamId]
    );

    const isArchivedTeam = teamStatusCheck.rows[0]?.archived_at !== null;
    const isSelfRemoval = String(userId) === String(memberId);

    if (isArchivedTeam) {
      // For archived teams, check if user has permission to remove members
      const authCheckArchived = await db.pool.query(
        `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, userId]
      );

      if (authCheckArchived.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Not authorized - you are not a member of this team",
        });
      }

      const userRole = authCheckArchived.rows[0].role;

      // Self-removal is always allowed
      // Owners can remove anyone
      // Admins can remove regular members
      if (!isSelfRemoval) {
        if (userRole !== "owner" && userRole !== "admin") {
          return res.status(403).json({
            success: false,
            message: "Not authorized to remove other members",
          });
        }

        // Check the target member's role
        const targetCheck = await db.pool.query(
          `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
          [teamId, memberId]
        );

        if (targetCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Member not found in this team",
          });
        }

        const targetRole = targetCheck.rows[0].role;

        // Admins cannot remove other admins or owners
        if (
          userRole === "admin" &&
          (targetRole === "admin" || targetRole === "owner")
        ) {
          return res.status(403).json({
            success: false,
            message: "Admins cannot remove other admins or owners",
          });
        }

        // Owners cannot remove other owners
        if (targetRole === "owner" && userRole !== "owner") {
          return res.status(403).json({
            success: false,
            message: "Only owners can remove other owners",
          });
        }
      }

      // Get member info for the leave/removal message
      const memberInfo = await db.pool.query(
        `SELECT first_name, last_name, username FROM users WHERE id = $1`,
        [memberId]
      );

      const m = memberInfo.rows[0];
      const memberName =
        m?.first_name && m?.last_name
          ? `${m.first_name} ${m.last_name}`
          : m?.username || "A member";

      // Remove membership
      await db.pool.query(
        `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, memberId]
      );

      // Insert appropriate messages
      if (isSelfRemoval) {
        const leaveMessage = `🚪 MEMBER_LEFT:${memberId}:${memberName}`;
        await db.pool.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [memberId, teamId, leaveMessage]
        );
      } else {
        // Get team name and remover name for proper message formatting
        const teamResult = await db.pool.query(
          `SELECT name FROM teams WHERE id = $1`,
          [teamId]
        );
        const teamName = teamResult.rows[0]?.name || "the team";

        const removerInfo = await db.pool.query(
          `SELECT first_name, last_name, username FROM users WHERE id = $1`,
          [userId]
        );
        const r = removerInfo.rows[0];
        const removerName =
          r?.first_name && r?.last_name
            ? `${r.first_name} ${r.last_name}`
            : r?.username || "An admin";

        // 1. Send DM to removed member
        const teamToken = `${teamId}:${teamName}`;
        const removerToken = `${userId}:${removerName}`;
        const memberToken = `${memberId}:${memberName}`;
        const dmMessage = `🚫 MEMBER_REMOVED: ${teamToken} | ${removerToken} | ${memberToken}`;

        await db.pool.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [userId, memberId, dmMessage]
        );

        // 2. Send message to team chat
        const teamChatMessage = `🚫 MEMBER_REMOVED_PUBLIC: ${teamToken} | ${memberToken}`;
        await db.pool.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [userId, teamId, teamChatMessage]
        );
      }

      // Cleanup archived team if empty
      try {
        await checkAndCleanupArchivedTeam(parseInt(teamId));
      } catch (cleanupError) {
        console.error("Cleanup check failed:", cleanupError);
      }

      // === Socket events for archived team member removal ===
      const io = req.app.get("io");

      if (!isSelfRemoval && io) {
        // Notify the removed member to kick them from the chat
        io.to(`user:${memberId}`).emit("team:member_kicked", {
          teamId: parseInt(teamId),
          memberId: parseInt(memberId),
        });

        io.to(`user:${memberId}`).emit("notification:new", {
          type: "member_removed",
          teamId: parseInt(teamId),
        });
      }

      return res.status(200).json({
        success: true,
        message: isSelfRemoval
          ? "Successfully left the archived team"
          : "Member removed successfully",
      });
    }

    // === Non-archived team ===
    const authCheck = await db.pool.query(
      `
      SELECT tm.role 
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.team_id = $1 
      AND tm.user_id = $2
      AND t.archived_at IS NULL
      `,
      [teamId, userId]
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to remove members from this team",
      });
    }

    const userRole = authCheck.rows[0].role;

    if (!isSelfRemoval && userRole !== "owner" && userRole !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to remove other members",
      });
    }

    const targetMemberCheck = await db.pool.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, memberId]
    );

    if (targetMemberCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found in this team",
      });
    }

    const memberRole = targetMemberCheck.rows[0].role;

    if (
      !isSelfRemoval &&
      (memberRole === "owner" || memberRole === "admin") &&
      userRole !== "owner"
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to remove team administrators",
      });
    }

    if (memberRole === "owner") {
      const ownerCount = await db.pool.query(
        `SELECT COUNT(*) FROM team_members WHERE team_id = $1 AND role = 'owner'`,
        [teamId]
      );

      if (parseInt(ownerCount.rows[0].count, 10) <= 1) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot remove the last team owner. Transfer ownership first.",
        });
      }
    }

    const client = await db.pool.connect();

    let teamName = "the team";
    let memberName = "A member";
    let removerName = "Someone";

    try {
      await client.query("BEGIN");

      // Fetch names inside the transaction so we can write the correct system message ONCE
      const teamResult = await client.query(
        `SELECT name FROM teams WHERE id = $1`,
        [teamId]
      );
      teamName = teamResult.rows[0]?.name || "the team";

      const memberInfo = await client.query(
        `SELECT first_name, last_name, username FROM users WHERE id = $1`,
        [memberId]
      );
      const m = memberInfo.rows[0];
      memberName =
        m?.first_name && m?.last_name
          ? `${m.first_name} ${m.last_name}`
          : m?.username || "A member";

      const removerInfo = await client.query(
        `SELECT first_name, last_name, username FROM users WHERE id = $1`,
        [userId]
      );
      const r = removerInfo.rows[0];
      removerName =
        r?.first_name && r?.last_name
          ? `${r.first_name} ${r.last_name}`
          : r?.username || "Someone";

      // Delete membership
      await client.query(
        `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, memberId]
      );

      // Insert ONE team-chat system message
      let teamChatMessage;
      let senderForTeamChat;

      if (isSelfRemoval) {
        teamChatMessage = `🚪 MEMBER_LEFT:${memberId}:${memberName}`;
        senderForTeamChat = memberId;
      } else {
        const teamToken = `${teamId}:${teamName}`;
        const memberToken = `${memberId}:${memberName}`;
        teamChatMessage = `🚫 MEMBER_REMOVED_PUBLIC: ${teamToken} | ${memberToken}`;
        senderForTeamChat = userId;
      }

      await client.query(
        `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())`,
        [senderForTeamChat, teamId, teamChatMessage]
      );

      await client.query("COMMIT");
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }

    // === After commit: notifications + DM ===
    const io = req.app.get("io");

    if (isSelfRemoval) {
      try {
        await notifyTeamMembers({
          teamId: parseInt(teamId),
          excludeUserId: parseInt(memberId),
          type: "member_left",
          title: `${memberName} left ${teamName}`,
          referenceType: "team_member",
          referenceId: parseInt(memberId),
          actorId: parseInt(memberId),
        });

        io?.to(`team:${teamId}`).emit("notification:new", {
          type: "member_left",
          teamId: parseInt(teamId),
        });
      } catch (e) {
        console.error("Error creating leave notification:", e);
      }
    } else {
      try {
        // DM to removed member
        const teamToken = `${teamId}:${teamName}`;
        const removerToken = `${userId}:${removerName}`;
        const memberToken = `${memberId}:${memberName}`;
        const removeSystemMessage = `🚫 MEMBER_REMOVED: ${teamToken} | ${removerToken} | ${memberToken}`;

        await db.pool.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [userId, memberId, removeSystemMessage]
        );

        await createNotification({
          userId: parseInt(memberId),
          type: "member_removed",
          title: `You were removed from ${teamName}`,
          message: null,
          referenceType: "team_member",
          referenceId: parseInt(teamId),
          teamId: parseInt(teamId),
          actorId: parseInt(userId),
        });

        io?.to(`user:${memberId}`).emit("notification:new", {
          type: "member_removed",
          teamId: parseInt(teamId),
        });

        // notify remaining members
        await notifyTeamMembers({
          teamId: parseInt(teamId),
          excludeUserId: parseInt(memberId),
          type: "member_left",
          title: `${memberName} was removed from ${teamName}`,
          referenceType: "team_member",
          referenceId: parseInt(memberId),
          actorId: parseInt(userId),
        });

        io?.to(`team:${teamId}`).emit("notification:new", {
          type: "member_left",
          teamId: parseInt(teamId),
        });
      } catch (e) {
        console.error("Error creating removal notification:", e);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Member removed successfully",
    });
  } catch (error) {
    console.error("Remove team member error:", error);
    return res.status(500).json({
      success: false,
      message: "Error removing team member",
      error: error.message,
    });
  }
};

const updateMemberRole = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const memberId = req.params.memberId;
    const userId = req.user.id;
    const { newRole } = req.body;

    // Validate role
    const validRoles = ["member", "admin"];
    if (!validRoles.includes(newRole)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Must be 'member' or 'admin'",
      });
    }

    // Check if the user making the request is authorized (owner or admin)
    const authCheck = await db.pool.query(
      `
      SELECT tm.role 
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.team_id = $1 
      AND tm.user_id = $2
      AND (tm.role = 'owner' OR tm.role = 'admin')
      AND t.archived_at IS NULL
    `,
      [teamId, userId]
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to change member roles in this team",
      });
    }

    const userRole = authCheck.rows[0].role;

    // Check if target member exists and get their current role
    const memberCheck = await db.pool.query(
      `
      SELECT role FROM team_members 
      WHERE team_id = $1 AND user_id = $2
    `,
      [teamId, memberId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found in this team",
      });
    }

    const memberCurrentRole = memberCheck.rows[0].role;

    // Only owners can change admin roles
    if (memberCurrentRole === "admin" && userrole !== "owner") {
      return res.status(403).json({
        success: false,
        message: "Only team owners can change admin roles",
      });
    }

    // Only owners can promote to admin
    if (newRole === "admin" && userrole !== "owner") {
      return res.status(403).json({
        success: false,
        message: "Only team owners can promote members to admin",
      });
    }

    // Can't change owner role
    if (memberCurrentrole === "owner") {
      return res.status(403).json({
        success: false,
        message: "Cannot change owner role",
      });
    }

    // Update member role
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
        UPDATE team_members 
        SET role = $1 
        WHERE team_id = $2 AND user_id = $3
      `,
        [newRole, teamId, memberId]
      );

      await client.query("COMMIT");

      res.status(200).json({
        success: true,
        message: `Member role updated to ${newRole} successfully`,
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      console.error("Database error while updating member role:", dbError);
      res.status(500).json({
        success: false,
        message: "Database error while updating member role",
        errorDetails: dbError.message,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Update member role error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating member role",
      error: error.message,
    });
  }
};

module.exports = {
  createTeam,
  getAllTeams,
  getTeamById,
  getUserTeams,
  getUserRoleInTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  applyToJoinTeam,
  getTeamApplications,
  handleTeamApplication,
  getUserPendingApplications,
  cancelApplication,
  updateMemberRole,
  permanentlyDeleteTeam,
  checkAndCleanupArchivedTeam,
};
