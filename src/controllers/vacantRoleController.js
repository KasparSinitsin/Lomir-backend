const db = require("../config/database");
const { geocodeAddress } = require("../utils/geocodingUtil");

// ============================================================
// Helper: Check if user is owner or admin of a team
// ============================================================
const checkTeamAuth = async (teamId, userId) => {
  const result = await db.pool.query(
    `SELECT tm.role
     FROM team_members tm
     JOIN teams t ON tm.team_id = t.id
     WHERE tm.team_id = $1
       AND tm.user_id = $2
       AND (tm.role = 'owner' OR tm.role = 'admin')
       AND t.archived_at IS NULL`,
    [teamId, userId],
  );
  return result.rows.length > 0 ? result.rows[0].role : null;
};

// ============================================================
// GET /api/teams/:teamId/vacant-roles
// List all vacant roles for a team (public)
// ============================================================
const getVacantRoles = async (req, res) => {
  try {
    const { teamId } = req.params;
    const statusFilter = req.query.status || "open"; // default: only open roles

    // Fetch roles
    const rolesResult = await db.pool.query(
      `SELECT vr.*,
              u.first_name AS creator_first_name,
              u.last_name AS creator_last_name,
              u.username AS creator_username
       FROM team_vacant_roles vr
       JOIN users u ON vr.created_by = u.id
       WHERE vr.team_id = $1
         AND ($2 = 'all' OR vr.status = $2)
       ORDER BY vr.created_at DESC`,
      [teamId, statusFilter],
    );

    const roles = rolesResult.rows;

    if (roles.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // Fetch tags and badges for all roles in batch
    const roleIds = roles.map((r) => r.id);

    const tagsResult = await db.pool.query(
      `SELECT vrt.role_id, t.id AS tag_id, t.name, t.category, t.supercategory
       FROM team_vacant_role_tags vrt
       JOIN tags t ON vrt.tag_id = t.id
       WHERE vrt.role_id = ANY($1)
       ORDER BY t.supercategory, t.category, t.name`,
      [roleIds],
    );

    const badgesResult = await db.pool.query(
      `SELECT vrb.role_id, b.id AS badge_id, b.name, b.category, b.color, b.image_url, b.cat_image_url
       FROM team_vacant_role_badges vrb
       JOIN badges b ON vrb.badge_id = b.id
       WHERE vrb.role_id = ANY($1)
       ORDER BY b.category, b.name`,
      [roleIds],
    );

    // Group tags and badges by role_id
    const tagsByRole = {};
    const badgesByRole = {};

    for (const tag of tagsResult.rows) {
      if (!tagsByRole[tag.role_id]) tagsByRole[tag.role_id] = [];
      tagsByRole[tag.role_id].push(tag);
    }

    for (const badge of badgesResult.rows) {
      if (!badgesByRole[badge.role_id]) badgesByRole[badge.role_id] = [];
      badgesByRole[badge.role_id].push(badge);
    }

    // Attach to each role
    const enrichedRoles = roles.map((role) => ({
      ...role,
      tags: tagsByRole[role.id] || [],
      badges: badgesByRole[role.id] || [],
    }));

    res.status(200).json({
      success: true,
      data: enrichedRoles,
    });
  } catch (error) {
    console.error("Error fetching vacant roles:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching vacant roles",
      error: error.message,
    });
  }
};

// ============================================================
// GET /api/teams/:teamId/vacant-roles/:roleId
// Get a single vacant role by ID
// ============================================================
const getVacantRoleById = async (req, res) => {
  try {
    const { teamId, roleId } = req.params;

    const roleResult = await db.pool.query(
      `SELECT vr.*,
              u.first_name AS creator_first_name,
              u.last_name AS creator_last_name,
              u.username AS creator_username
       FROM team_vacant_roles vr
       JOIN users u ON vr.created_by = u.id
       WHERE vr.id = $1 AND vr.team_id = $2`,
      [roleId, teamId],
    );

    if (roleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vacant role not found",
      });
    }

    const role = roleResult.rows[0];

    // Fetch tags
    const tagsResult = await db.pool.query(
      `SELECT t.id AS tag_id, t.name, t.category, t.supercategory
       FROM team_vacant_role_tags vrt
       JOIN tags t ON vrt.tag_id = t.id
       WHERE vrt.role_id = $1
       ORDER BY t.supercategory, t.category, t.name`,
      [roleId],
    );

    // Fetch badges
    const badgesResult = await db.pool.query(
      `SELECT b.id AS badge_id, b.name, b.category, b.color, b.image_url, b.cat_image_url
       FROM team_vacant_role_badges vrb
       JOIN badges b ON vrb.badge_id = b.id
       WHERE vrb.role_id = $1
       ORDER BY b.category, b.name`,
      [roleId],
    );

    role.tags = tagsResult.rows;
    role.badges = badgesResult.rows;

    res.status(200).json({
      success: true,
      data: role,
    });
  } catch (error) {
    console.error("Error fetching vacant role:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching vacant role",
      error: error.message,
    });
  }
};

// ============================================================
// POST /api/teams/:teamId/vacant-roles
// Create a new vacant role (owner/admin only)
// ============================================================
const createVacantRole = async (req, res) => {
  try {
    const { teamId } = req.params;
    const userId = req.user.id;

    // Authorization check
    const userRole = await checkTeamAuth(teamId, userId);
    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to create vacant roles for this team",
      });
    }

    const {
      role_name,
      bio,
      postal_code,
      city,
      country,
      state,
      max_distance_km,
      is_remote,
      tag_ids, // array of tag IDs
      badge_ids, // array of badge IDs
    } = req.body;

    // Validate required fields
    if (!role_name || !role_name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Role name is required",
      });
    }

    // Normalize location: if remote, clear location fields
    const isRemote = is_remote === true || is_remote === "true";
    const finalPostalCode = isRemote ? null : postal_code || null;
    const finalCity = isRemote ? null : city || null;
    const finalCountry = isRemote ? null : country || null;
    let finalState = isRemote ? null : state || null;
    let finalLatitude = null;
    let finalLongitude = null;
    const finalMaxDistance = isRemote ? null : max_distance_km || null;

    // ── Geocode if not remote and we have enough location data ──
    if (!isRemote && (finalPostalCode || finalCity) && finalCountry) {
      console.log(
        `Geocoding vacant role location: "${finalPostalCode || ""} ${finalCity || ""}, ${finalCountry}"`,
      );
      const coordinates = await geocodeAddress({
        postal_code: finalPostalCode,
        city: finalCity,
        country: finalCountry,
      });

      if (coordinates) {
        finalLatitude = coordinates.latitude;
        finalLongitude = coordinates.longitude;
        // Use geocoded state if we don't already have one
        if (!finalState && coordinates.state) {
          finalState = coordinates.state;
        }
        console.log(
          `✅ Geocoded vacant role: lat=${finalLatitude}, lng=${finalLongitude}, state=${finalState}`,
        );
      } else {
        console.log("⚠️ Geocoding returned no results for vacant role");
      }
    } else if (isRemote) {
      console.log("Skipping geocoding for remote role");
    }

    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      // Insert the role
      const roleResult = await client.query(
        `INSERT INTO team_vacant_roles (
          team_id, created_by, role_name, bio,
          postal_code, city, country, state,
          latitude, longitude, max_distance_km, is_remote
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          teamId,
          userId,
          role_name.trim(),
          bio?.trim() || null,
          finalPostalCode,
          finalCity,
          finalCountry,
          finalState,
          finalLatitude,
          finalLongitude,
          finalMaxDistance,
          isRemote,
        ],
      );

      const roleId = roleResult.rows[0].id;

      // Insert tags if provided
      const tags = [];
      if (tag_ids && tag_ids.length > 0) {
        // Validate that all tag IDs exist
        const tagCheck = await client.query(
          `SELECT id FROM tags WHERE id = ANY($1)`,
          [tag_ids],
        );
        const validTagIds = tagCheck.rows.map((r) => r.id);
        const invalidTags = tag_ids.filter((id) => !validTagIds.includes(id));

        if (invalidTags.length > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: `Invalid tag IDs: ${invalidTags.join(", ")}`,
          });
        }

        for (const tagId of tag_ids) {
          await client.query(
            `INSERT INTO team_vacant_role_tags (role_id, tag_id)
             VALUES ($1, $2)`,
            [roleId, tagId],
          );
        }

        // Fetch the full tag data for the response
        const tagsResult = await client.query(
          `SELECT t.id AS tag_id, t.name, t.category, t.supercategory
           FROM team_vacant_role_tags vrt
           JOIN tags t ON vrt.tag_id = t.id
           WHERE vrt.role_id = $1`,
          [roleId],
        );
        tags.push(...tagsResult.rows);
      }

      // Insert badges if provided
      const badges = [];
      if (badge_ids && badge_ids.length > 0) {
        // Validate that all badge IDs exist
        const badgeCheck = await client.query(
          `SELECT id FROM badges WHERE id = ANY($1)`,
          [badge_ids],
        );
        const validBadgeIds = badgeCheck.rows.map((r) => r.id);
        const invalidBadges = badge_ids.filter(
          (id) => !validBadgeIds.includes(id),
        );

        if (invalidBadges.length > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: `Invalid badge IDs: ${invalidBadges.join(", ")}`,
          });
        }

        for (const badgeId of badge_ids) {
          await client.query(
            `INSERT INTO team_vacant_role_badges (role_id, badge_id)
             VALUES ($1, $2)`,
            [roleId, badgeId],
          );
        }

        // Fetch the full badge data for the response
        const badgesResult = await client.query(
          `SELECT b.id AS badge_id, b.name, b.category, b.color, b.image_url, b.cat_image_url
           FROM team_vacant_role_badges vrb
           JOIN badges b ON vrb.badge_id = b.id
           WHERE vrb.role_id = $1`,
          [roleId],
        );
        badges.push(...badgesResult.rows);
      }

      await client.query("COMMIT");

      const role = {
        ...roleResult.rows[0],
        tags,
        badges,
      };

      console.log(
        `✅ Vacant role "${role_name}" created for team ${teamId} by user ${userId}`,
      );

      res.status(201).json({
        success: true,
        message: "Vacant role created successfully",
        data: role,
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      console.error("Database error creating vacant role:", dbError);
      res.status(500).json({
        success: false,
        message: "Database error while creating vacant role",
        error: dbError.message,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Create vacant role error:", error);
    res.status(500).json({
      success: false,
      message: "Error creating vacant role",
      error: error.message,
    });
  }
};

// ============================================================
// PUT /api/teams/:teamId/vacant-roles/:roleId
// Update a vacant role (owner/admin only)
// ============================================================
const updateVacantRole = async (req, res) => {
  try {
    const { teamId, roleId } = req.params;
    const userId = req.user.id;

    // Authorization check
    const userRole = await checkTeamAuth(teamId, userId);
    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update vacant roles for this team",
      });
    }

    // Verify role exists and belongs to this team
    const existingRole = await db.pool.query(
      `SELECT * FROM team_vacant_roles WHERE id = $1 AND team_id = $2`,
      [roleId, teamId],
    );

    if (existingRole.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vacant role not found",
      });
    }

    const {
      role_name,
      bio,
      postal_code,
      city,
      country,
      state,
      max_distance_km,
      is_remote,
      tag_ids,
      badge_ids,
    } = req.body;

    // Normalize location
    const isRemote = is_remote === true || is_remote === "true";
    const finalPostalCode = isRemote ? null : postal_code || null;
    const finalCity = isRemote ? null : city || null;
    const finalCountry = isRemote ? null : country || null;
    let finalState = isRemote ? null : state || null;
    let finalLatitude = null;
    let finalLongitude = null;
    const finalMaxDistance = isRemote ? null : max_distance_km || null;

    // ── Geocode if not remote and we have enough location data ──
    if (!isRemote && (finalPostalCode || finalCity) && finalCountry) {
      console.log(
        `Geocoding vacant role location (update): "${finalPostalCode || ""} ${finalCity || ""}, ${finalCountry}"`,
      );
      const coordinates = await geocodeAddress({
        postal_code: finalPostalCode,
        city: finalCity,
        country: finalCountry,
      });

      if (coordinates) {
        finalLatitude = coordinates.latitude;
        finalLongitude = coordinates.longitude;
        if (!finalState && coordinates.state) {
          finalState = coordinates.state;
        }
        console.log(
          `✅ Geocoded vacant role (update): lat=${finalLatitude}, lng=${finalLongitude}, state=${finalState}`,
        );
      } else {
        console.log("⚠️ Geocoding returned no results for vacant role update");
      }
    } else if (isRemote) {
      console.log("Skipping geocoding for remote role (update)");
    }

    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      // Update the role
      const roleResult = await client.query(
        `UPDATE team_vacant_roles SET
          role_name       = COALESCE($1, role_name),
          bio             = $2,
          postal_code     = $3,
          city            = $4,
          country         = $5,
          state           = $6,
          latitude        = $7,
          longitude       = $8,
          max_distance_km = $9,
          is_remote       = $10,
          updated_at      = NOW()
        WHERE id = $11 AND team_id = $12
        RETURNING *`,
        [
          role_name?.trim() || null,
          bio?.trim() || null,
          finalPostalCode,
          finalCity,
          finalCountry,
          finalState,
          finalLatitude,
          finalLongitude,
          finalMaxDistance,
          isRemote,
          roleId,
          teamId,
        ],
      );

      // Replace tags if provided
      if (tag_ids !== undefined) {
        await client.query(
          `DELETE FROM team_vacant_role_tags WHERE role_id = $1`,
          [roleId],
        );

        if (tag_ids && tag_ids.length > 0) {
          const tagCheck = await client.query(
            `SELECT id FROM tags WHERE id = ANY($1)`,
            [tag_ids],
          );
          const validTagIds = tagCheck.rows.map((r) => r.id);
          const invalidTags = tag_ids.filter((id) => !validTagIds.includes(id));

          if (invalidTags.length > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: `Invalid tag IDs: ${invalidTags.join(", ")}`,
            });
          }

          for (const tagId of tag_ids) {
            await client.query(
              `INSERT INTO team_vacant_role_tags (role_id, tag_id)
               VALUES ($1, $2)`,
              [roleId, tagId],
            );
          }
        }
      }

      // Replace badges if provided
      if (badge_ids !== undefined) {
        await client.query(
          `DELETE FROM team_vacant_role_badges WHERE role_id = $1`,
          [roleId],
        );

        if (badge_ids && badge_ids.length > 0) {
          const badgeCheck = await client.query(
            `SELECT id FROM badges WHERE id = ANY($1)`,
            [badge_ids],
          );
          const validBadgeIds = badgeCheck.rows.map((r) => r.id);
          const invalidBadges = badge_ids.filter(
            (id) => !validBadgeIds.includes(id),
          );

          if (invalidBadges.length > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: `Invalid badge IDs: ${invalidBadges.join(", ")}`,
            });
          }

          for (const badgeId of badge_ids) {
            await client.query(
              `INSERT INTO team_vacant_role_badges (role_id, badge_id)
               VALUES ($1, $2)`,
              [roleId, badgeId],
            );
          }
        }
      }

      await client.query("COMMIT");

      // Fetch the full updated role with tags and badges
      const tagsResult = await db.pool.query(
        `SELECT t.id AS tag_id, t.name, t.category, t.supercategory
         FROM team_vacant_role_tags vrt
         JOIN tags t ON vrt.tag_id = t.id
         WHERE vrt.role_id = $1`,
        [roleId],
      );

      const badgesResult = await db.pool.query(
        `SELECT b.id AS badge_id, b.name, b.category, b.color, b.image_url, b.cat_image_url
         FROM team_vacant_role_badges vrb
         JOIN badges b ON vrb.badge_id = b.id
         WHERE vrb.role_id = $1`,
        [roleId],
      );

      const updatedRole = {
        ...roleResult.rows[0],
        tags: tagsResult.rows,
        badges: badgesResult.rows,
      };

      console.log(`✅ Vacant role ${roleId} updated for team ${teamId}`);

      res.status(200).json({
        success: true,
        message: "Vacant role updated successfully",
        data: updatedRole,
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      console.error("Database error updating vacant role:", dbError);
      res.status(500).json({
        success: false,
        message: "Database error while updating vacant role",
        error: dbError.message,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Update vacant role error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating vacant role",
      error: error.message,
    });
  }
};

// ============================================================
// DELETE /api/teams/:teamId/vacant-roles/:roleId
// Delete a vacant role (owner/admin only)
// ============================================================
const deleteVacantRole = async (req, res) => {
  try {
    const { teamId, roleId } = req.params;
    const userId = req.user.id;

    // Authorization check
    const userRole = await checkTeamAuth(teamId, userId);
    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete vacant roles for this team",
      });
    }

    // CASCADE will handle join tables automatically
    const result = await db.pool.query(
      `DELETE FROM team_vacant_roles
       WHERE id = $1 AND team_id = $2
       RETURNING id, role_name`,
      [roleId, teamId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vacant role not found",
      });
    }

    console.log(
      `🗑️ Vacant role "${result.rows[0].role_name}" (${roleId}) deleted from team ${teamId}`,
    );

    res.status(200).json({
      success: true,
      message: "Vacant role deleted successfully",
    });
  } catch (error) {
    console.error("Delete vacant role error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting vacant role",
      error: error.message,
    });
  }
};

// ============================================================
// PUT /api/teams/:teamId/vacant-roles/:roleId/status
// Update role status (open → filled/closed)
// ============================================================
const updateVacantRoleStatus = async (req, res) => {
  try {
    const { teamId, roleId } = req.params;
    const userId = req.user.id;
    const { status, filled_by } = req.body;

    // Authorization check
    const userRole = await checkTeamAuth(teamId, userId);
    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update vacant role status",
      });
    }

    // Validate status
    const validStatuses = ["open", "filled", "closed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // If marking as filled, optionally record who filled it
    const result = await db.pool.query(
      `UPDATE team_vacant_roles
       SET status = $1,
           filled_by = $2,
           updated_at = NOW()
       WHERE id = $3 AND team_id = $4
       RETURNING *`,
      [status, status === "filled" ? filled_by || null : null, roleId, teamId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vacant role not found",
      });
    }

    console.log(
      `✅ Vacant role ${roleId} status changed to "${status}" in team ${teamId}`,
    );

    res.status(200).json({
      success: true,
      message: `Vacant role status updated to "${status}"`,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Update vacant role status error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating vacant role status",
      error: error.message,
    });
  }
};

module.exports = {
  getVacantRoles,
  getVacantRoleById,
  createVacantRole,
  updateVacantRole,
  deleteVacantRole,
  updateVacantRoleStatus,
};
