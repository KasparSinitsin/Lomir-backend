const db = require("../config/database");

/**
 * Send a team invitation to a user
 */
const sendTeamInvitation = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const inviterId = req.user.id;
    const { inviteeId, invitee_id, message = "" } = req.body;
    const finalInviteeId = inviteeId || invitee_id;

    if (!finalInviteeId) {
      return res.status(400).json({
        success: false,
        message: "Invitee ID is required",
      });
    }

    // Check if team exists and is not archived
    const teamCheck = await db.pool.query(
      `SELECT id, name, max_members FROM teams WHERE id = $1 AND archived_at IS NULL`,
      [teamId]
    );

    if (teamCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const team = teamCheck.rows[0];

    // Check if inviter is owner or admin
    const inviterRoleCheck = await db.pool.query(
      `SELECT role FROM team_members 
       WHERE team_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [teamId, inviterId]
    );

    if (inviterRoleCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Only team owners and admins can send invitations",
      });
    }

    // Check if invitee exists
    const inviteeCheck = await db.pool.query(
      `SELECT id, username FROM users WHERE id = $1`,
      [finalInviteeId]
    );

    if (inviteeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if invitee is already a team member
    const memberCheck = await db.pool.query(
      `SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, finalInviteeId]
    );

    if (memberCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User is already a member of this team",
      });
    }

    // Check if team is full
    const memberCount = await db.pool.query(
      `SELECT COUNT(*) as count FROM team_members WHERE team_id = $1`,
      [teamId]
    );

 if (team.max_members !== null && parseInt(memberCount.rows[0].count) >= team.max_members) {
  return res.status(400).json({
    success: false,
    message: "Team is already at maximum capacity",
  });
}

    // Check if there's already a pending invitation
    const existingInvitation = await db.pool.query(
      `SELECT id FROM team_invitations 
       WHERE team_id = $1 AND invitee_id = $2 AND status = 'pending'`,
      [teamId, finalInviteeId]
    );

    if (existingInvitation.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "An invitation is already pending for this user",
      });
    }

    // Check if user has a pending application
    const existingApplication = await db.pool.query(
      `SELECT id FROM team_applications 
       WHERE team_id = $1 AND applicant_id = $2 AND status = 'pending'`,
      [teamId, finalInviteeId]
    );

    if (existingApplication.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "This user already has a pending application for this team.",
      });
    }

    // Create the invitation
    const invitationResult = await db.pool.query(
      `INSERT INTO team_invitations (team_id, inviter_id, invitee_id, message, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW())
       RETURNING id`,
      [teamId, inviterId, finalInviteeId, message.trim()]
    );

    res.status(201).json({
      success: true,
      message: "Invitation sent successfully",
      data: {
        invitationId: invitationResult.rows[0].id,
      },
    });
  } catch (error) {
    console.error("Error sending team invitation:", error);
    res.status(500).json({
      success: false,
      message: "Error sending invitation",
      error: error.message,
    });
  }
};

/**
 * Get all pending invitations for the current user
 */
const getUserReceivedInvitations = async (req, res) => {
  try {
    const userId = req.user.id;

    const invitationsResult = await db.pool.query(
      `SELECT 
        ti.id, ti.team_id, ti.message, ti.status, ti.created_at,
        t.name as team_name, t.description as team_description, 
        t.teamavatar_url, t.max_members, t.is_public,
        (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as current_members_count,
        u.id as inviter_id, u.username as inviter_username, 
        u.first_name as inviter_first_name, u.last_name as inviter_last_name,
        u.avatar_url as inviter_avatar_url
       FROM team_invitations ti
       JOIN teams t ON ti.team_id = t.id
       JOIN users u ON ti.inviter_id = u.id
       WHERE ti.invitee_id = $1 AND ti.status = 'pending' AND t.archived_at IS NULL
       ORDER BY ti.created_at DESC`,
      [userId]
    );

    const invitations = invitationsResult.rows.map((row) => ({
      id: row.id,
      message: row.message,
      status: row.status,
      created_at: row.created_at,
      team: {
        id: row.team_id,
        name: row.team_name,
        description: row.team_description,
        teamavatar_url: row.teamavatar_url,
        max_members: row.max_members,
        is_public: row.is_public === true,
        current_members_count: parseInt(row.current_members_count),
      },
      inviter: {
        id: row.inviter_id,
        username: row.inviter_username,
        first_name: row.inviter_first_name,
        last_name: row.inviter_last_name,
        avatar_url: row.inviter_avatar_url,
      },
    }));

    res.status(200).json({
      success: true,
      data: invitations,
    });
  } catch (error) {
    console.error("Error fetching user invitations:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching invitations",
      error: error.message,
    });
  }
};

/**
 * Get all pending invitations sent by a team
 */
const getTeamSentInvitations = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const userId = req.user.id;

    // Check if user is authorized (owner or admin)
    const authCheck = await db.pool.query(
      `SELECT role FROM team_members 
       WHERE team_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [teamId, userId]
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view team invitations",
      });
    }

    const invitationsResult = await db.pool.query(
      `SELECT 
        ti.id, ti.message, ti.status, ti.created_at,
        u.id as invitee_id, u.username, u.first_name, u.last_name,
        u.avatar_url, u.bio, u.postal_code,
        inv.username as inviter_username
       FROM team_invitations ti
       JOIN users u ON ti.invitee_id = u.id
       JOIN users inv ON ti.inviter_id = inv.id
       WHERE ti.team_id = $1 AND ti.status = 'pending'
       ORDER BY ti.created_at DESC`,
      [teamId]
    );

    const invitations = invitationsResult.rows.map((row) => ({
      id: row.id,
      message: row.message,
      status: row.status,
      created_at: row.created_at,
      invitee: {
        id: row.invitee_id,
        username: row.username,
        first_name: row.first_name,
        last_name: row.last_name,
        avatar_url: row.avatar_url,
        bio: row.bio,
        postal_code: row.postal_code,
      },
      inviter_username: row.inviter_username,
    }));

    res.status(200).json({
      success: true,
      data: invitations,
    });
  } catch (error) {
    console.error("Error fetching team invitations:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team invitations",
      error: error.message,
    });
  }
};

/**
 * Respond to an invitation (accept or decline)
 */
const respondToInvitation = async (req, res) => {
  try {
    const invitationId = req.params.invitationId;
    const userId = req.user.id;
    const { action } = req.body;

    if (!["accept", "decline"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be 'accept' or 'decline'",
      });
    }

    // Get invitation details
    const invitationResult = await db.pool.query(
      `SELECT ti.*, t.max_members, t.name as team_name
       FROM team_invitations ti
       JOIN teams t ON ti.team_id = t.id
       WHERE ti.id = $1 AND ti.invitee_id = $2 AND ti.status = 'pending'
       AND t.archived_at IS NULL`,
      [invitationId, userId]
    );

    if (invitationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invitation not found or already responded to",
      });
    }

    const invitation = invitationResult.rows[0];

    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      if (action === "accept") {
        // Check if team is still not full
        const memberCount = await client.query(
          `SELECT COUNT(*) as count FROM team_members WHERE team_id = $1`,
          [invitation.team_id]
        );

if (invitation.max_members !== null && parseInt(memberCount.rows[0].count) >= invitation.max_members) {
  await client.query("ROLLBACK");
  return res.status(400).json({
    success: false,
    message: "Team is now at maximum capacity",
  });
}

        // Add user to team
        await client.query(
          `INSERT INTO team_members (team_id, user_id, role, joined_at)
           VALUES ($1, $2, 'member', NOW())`,
          [invitation.team_id, userId]
        );

        // Update invitation status
        await client.query(
          `UPDATE team_invitations 
           SET status = 'accepted', responded_at = NOW()
           WHERE id = $1`,
          [invitationId]
        );
      } else {
        // Decline
        await client.query(
          `UPDATE team_invitations 
           SET status = 'declined', responded_at = NOW()
           WHERE id = $1`,
          [invitationId]
        );
      }

      await client.query("COMMIT");

      res.status(200).json({
        success: true,
        message:
          action === "accept"
            ? `You have joined ${invitation.team_name}!`
            : "Invitation declined",
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error responding to invitation:", error);
    res.status(500).json({
      success: false,
      message: "Error responding to invitation",
      error: error.message,
    });
  }
};

/**
 * Cancel a pending invitation (by team owner/admin)
 */
const cancelInvitation = async (req, res) => {
  try {
    const invitationId = req.params.invitationId;
    const userId = req.user.id;

    // Get invitation
    const invitationResult = await db.pool.query(
      `SELECT ti.team_id FROM team_invitations ti
       WHERE ti.id = $1 AND ti.status = 'pending'`,
      [invitationId]
    );

    if (invitationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invitation not found or already responded to",
      });
    }

    const teamId = invitationResult.rows[0].team_id;

    // Check if user is owner or admin
    const authCheck = await db.pool.query(
      `SELECT role FROM team_members 
       WHERE team_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [teamId, userId]
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this invitation",
      });
    }

    // Cancel the invitation
    await db.pool.query(
      `UPDATE team_invitations 
       SET status = 'canceled', responded_at = NOW()
       WHERE id = $1`,
      [invitationId]
    );

    res.status(200).json({
      success: true,
      message: "Invitation canceled successfully",
    });
  } catch (error) {
    console.error("Error canceling invitation:", error);
    res.status(500).json({
      success: false,
      message: "Error canceling invitation",
      error: error.message,
    });
  }
};

/**
 * Get teams where user can invite others (is owner or admin)
 */
const getTeamsWhereUserCanInvite = async (req, res) => {
  try {
    const userId = req.user.id;

    const teamsResult = await db.pool.query(
      `SELECT t.id, t.name, t.teamavatar_url, t.max_members,
              (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as current_members_count
       FROM teams t
       JOIN team_members tm ON t.id = tm.team_id
       WHERE tm.user_id = $1 AND tm.role IN ('owner', 'admin')
       AND t.archived_at IS NULL
       ORDER BY t.name ASC`,
      [userId]
    );

    // Filter out teams that are at capacity (skip check if unlimited)
const availableTeams = teamsResult.rows
  .filter((team) => 
    team.max_members === null || 
    parseInt(team.current_members_count) < team.max_members
  )
  .map((team) => ({
    id: team.id,
    name: team.name,
    teamavatar_url: team.teamavatar_url,
    max_members: team.max_members,
    current_members_count: parseInt(team.current_members_count),
    available_spots:
      team.max_members === null 
        ? null  // unlimited
        : team.max_members - parseInt(team.current_members_count),
  }));

    res.status(200).json({
      success: true,
      data: availableTeams,
    });
  } catch (error) {
    console.error("Error fetching teams for invite:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching teams",
      error: error.message,
    });
  }
};

module.exports = {
  sendTeamInvitation,
  getUserReceivedInvitations,
  getTeamSentInvitations,
  respondToInvitation,
  cancelInvitation,
  getTeamsWhereUserCanInvite,
};
