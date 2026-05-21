const { pool } = require("../config/database");
const { ensureBadgeVisibilityColumns } = require("../utils/badgeVisibilityUtils");

/**
 * @description Get all badges grouped by category
 * @route GET /api/badges
 * @access Public
 */
const getAllBadges = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, category, image_url, color, cat_image_url
       FROM badges
       ORDER BY category, name`,
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching badges:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching badges",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * Helper: Refresh all badge-related materialized views.
 * Silently skips if these are regular views (which auto-update).
 */
const refreshBadgeViews = async (clientOrPool) => {
  const viewNames = [
    "v_user_badge_credit_totals",
    "v_user_badges_with_totals",
    "v_user_badges_with_category_totals",
    "v_user_total_badge_credits",
  ];

  for (const viewName of viewNames) {
    try {
      await clientOrPool.query(`REFRESH MATERIALIZED VIEW ${viewName}`);
      if (process.env.NODE_ENV !== "production") {
        console.log(`🏅 Refreshed materialized view: ${viewName}`);
      }
    } catch (err) {
      if (
        err.message.includes("is not a materialized view") ||
        err.message.includes("does not exist")
      ) {
        // Regular view — auto-updates, no action needed
      } else {
        console.warn(`⚠️ Could not refresh ${viewName}:`, err.message);
      }
    }
  }
};

// ============================================================================
// Allowed context types for badge awards
// ============================================================================
const VALID_CONTEXT_TYPES = ["personal", "team", "project"];

const recalculateUserTagBadgeCredits = async (client, userId, tagId) => {
  if (!tagId) return;

  const totalsResult = await client.query(
    `SELECT
       COALESCE(SUM(credits), 0)::int AS badge_credits,
       (
         SELECT b.category
         FROM badge_awards ba
         JOIN badges b ON b.id = ba.badge_id
         WHERE ba.awarded_to_user_id = $1
           AND ba.tag_id = $2
         GROUP BY b.category
         ORDER BY SUM(ba.credits) DESC, b.category ASC
         LIMIT 1
       ) AS dominant_badge_category
     FROM badge_awards
     WHERE awarded_to_user_id = $1
       AND tag_id = $2`,
    [userId, tagId],
  );

  const nextCredits = Number(totalsResult.rows[0]?.badge_credits ?? 0);
  const nextDominantCategory =
    totalsResult.rows[0]?.dominant_badge_category ?? null;

  await client.query(
    `UPDATE user_tags
     SET badge_credits = $1,
         dominant_badge_category = $2
     WHERE user_id = $3
       AND tag_id = $4`,
    [nextCredits, nextDominantCategory, userId, tagId],
  );
};

/**
 * @description Award a badge to a user
 * @route POST /api/badges/award
 * @access Private (requires authentication)
 *
 * Expected body (camelCase from frontend, converted to snake_case by axios interceptor):
 *   {
 *     awarded_to_user_id: number,
 *     badge_id: number,
 *     credits: number (1, 2, or 3),
 *     reason: string (optional),
 *     context_type: string ("personal" | "team" | "project"),
 *     context_id: number (optional),
 *     team_id: number (optional, required when context_type is "team"),
 *     tag_id: number (optional, links award to a focus area/tag)
 *   }
 */
const awardBadge = async (req, res) => {
  const client = await pool.connect();

  try {
    const awardedByUserId = req.user.id; // From auth middleware

    if (process.env.NODE_ENV !== "production") {
      console.log("🏅 ====== AWARD BADGE CALLED ======");
      console.log("🏅 req.user.id:", awardedByUserId);
    }

    const {
      awarded_to_user_id,
      badge_id,
      credits,
      reason,
      context_type,
      team_id,
      tag_id,
      custom_team_name,
      project_name,
    } = req.body;

    // ── Basic validation ──
    if (!awarded_to_user_id) {
      return res.status(400).json({
        success: false,
        message: "awarded_to_user_id is required",
      });
    }

    if (!badge_id) {
      return res.status(400).json({
        success: false,
        message: "badge_id is required",
      });
    }

    if (!credits || ![1, 2, 3].includes(Number(credits))) {
      return res.status(400).json({
        success: false,
        message: "credits must be 1, 2, or 3",
      });
    }

    // Cannot award badge to yourself
    if (Number(awarded_to_user_id) === Number(awardedByUserId)) {
      return res.status(400).json({
        success: false,
        message: "You cannot award a badge to yourself",
      });
    }

    // ── Validate context_type ──
    const resolvedContextType = context_type || "personal";
    if (!VALID_CONTEXT_TYPES.includes(resolvedContextType)) {
      return res.status(400).json({
        success: false,
        message: `context_type must be one of: ${VALID_CONTEXT_TYPES.join(", ")}`,
      });
    }

    // ── Validate team_id when context is "team" ──
    if (resolvedContextType === "team") {
      if (!team_id && !custom_team_name?.trim()) {
        return res.status(400).json({
          success: false,
          message:
            "team_id or custom_team_name is required when context_type is 'team'",
        });
      }

      if (team_id) {
        // Verify team exists and is not archived
        const teamCheck = await pool.query(
          "SELECT id, name FROM teams WHERE id = $1 AND archived_at IS NULL",
          [team_id],
        );
        if (teamCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Team not found or archived",
          });
        }

        // Verify both awarder and awardee are members of the team
        const memberCheck = await pool.query(
          `SELECT user_id FROM team_members
           WHERE team_id = $1 AND user_id IN ($2, $3)`,
          [team_id, awardedByUserId, awarded_to_user_id],
        );
        if (memberCheck.rows.length < 2) {
          return res.status(400).json({
            success: false,
            message:
              "Both awarder and awardee must be members of the selected team",
          });
        }

        if (process.env.NODE_ENV !== "production") {
          console.log("🏅 Team context validated:", teamCheck.rows[0].name);
        }
      } else {
        if (process.env.NODE_ENV !== "production") {
          console.log("🏅 Custom team name:", custom_team_name);
        }
      }
    }

    // ── If team_id is provided with non-team context, still validate it exists ──
    if (team_id && resolvedContextType !== "team") {
      const teamCheck = await pool.query(
        "SELECT id FROM teams WHERE id = $1 AND archived_at IS NULL",
        [team_id],
      );
      if (teamCheck.rows.length === 0) {
        console.warn("⚠️ team_id provided but team not found, setting to null");
      }
    }

    // ── Validate tag_id if provided ──
    let resolvedTagId = null;
    if (tag_id) {
      const tagCheck = await pool.query(
        "SELECT id, name, category FROM tags WHERE id = $1",
        [tag_id],
      );
      if (tagCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Tag not found",
        });
      }
      resolvedTagId = tagCheck.rows[0].id;
      if (process.env.NODE_ENV !== "production") {
        console.log("🏅 Tag validated:", tagCheck.rows[0].name);
      }
    }

    // Verify badge exists
    const badgeCheck = await pool.query(
      "SELECT id, name, category FROM badges WHERE id = $1",
      [badge_id],
    );
    if (badgeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Badge not found",
      });
    }
    if (process.env.NODE_ENV !== "production") {
      console.log("🏅 Badge found:", badgeCheck.rows[0].name);
    }

    // Verify target user exists
    const userCheck = await pool.query(
      "SELECT id, first_name, last_name, username FROM users WHERE id = $1",
      [awarded_to_user_id],
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Target user not found",
      });
    }
    if (process.env.NODE_ENV !== "production") {
      console.log("🏅 Target user:", userCheck.rows[0].username);
    }

    // ── Insert award (main transaction) ──
    await client.query("BEGIN");
    await ensureBadgeVisibilityColumns(client);

    const insertResult = await client.query(
      `INSERT INTO badge_awards
  (awarded_to_user_id, badge_id, awarded_by_user_id, credits, reason, context_type, context_id, team_id, tag_id, custom_team_name, project_name, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING *`,
      [
        awarded_to_user_id,
        badge_id,
        awardedByUserId,
        Number(credits),
        reason || null,
        resolvedContextType,
        null,
        resolvedContextType === "team" ? team_id : team_id || null,
        resolvedTagId,
        custom_team_name || null,
        project_name || null,
      ],
    );

    if (process.env.NODE_ENV !== "production") {
      console.log("🏅 badge_awards INSERT success! ID:", insertResult.rows[0].id);
    }

    // New awards start private so the receiver can confirm them before they
    // become visible on their public profile.
    const hiddenAwardsResult = await client.query(
      `UPDATE users
       SET hidden_award_ids = (
             SELECT ARRAY(
               SELECT DISTINCT value
               FROM unnest(COALESCE(hidden_award_ids, '{}'::INTEGER[]) || $2::INTEGER) AS hidden_ids(value)
               ORDER BY value
             )
           ),
           updated_at = NOW()
       WHERE id = $1
       RETURNING hidden_award_ids`,
      [awarded_to_user_id, insertResult.rows[0].id],
    );

    // ── Non-critical: Update user_badges summary table (SAVEPOINT) ──
    try {
      await client.query("SAVEPOINT user_badges_sp");
      await client.query(
        `INSERT INTO user_badges (user_id, badge_id, awarded_by, awarded_at, team_id)
         VALUES ($1, $2, $3, NOW(), $4)`,
        [awarded_to_user_id, badge_id, awardedByUserId, team_id || null],
      );
      await client.query("RELEASE SAVEPOINT user_badges_sp");
      if (process.env.NODE_ENV !== "production") {
        console.log("🏅 user_badges INSERT OK");
      }
    } catch (ubError) {
      await client.query("ROLLBACK TO SAVEPOINT user_badges_sp");
      console.warn(
        "⚠️ user_badges INSERT failed (non-critical):",
        ubError.message,
      );
    }

    // ── Non-critical: Update tag badge_credits + dominant_badge_category (SAVEPOINT) ──
    if (resolvedTagId) {
      try {
        await client.query("SAVEPOINT tag_credit_sp");

        // Upsert: add tag to user_tags if not exists, then increment badge_credits
        await client.query(
          `INSERT INTO user_tags (user_id, tag_id, badge_credits)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, tag_id) DO UPDATE
           SET badge_credits = user_tags.badge_credits + $3`,
          [awarded_to_user_id, resolvedTagId, Number(credits)],
        );

        // Update dominant_badge_category from the aggregation view
        const dominantResult = await client.query(
          `SELECT badge_category
           FROM v_user_tag_dominant_category
           WHERE user_id = $1 AND tag_id = $2`,
          [awarded_to_user_id, resolvedTagId],
        );

        if (dominantResult.rows.length > 0) {
          await client.query(
            `UPDATE user_tags
             SET dominant_badge_category = $1
             WHERE user_id = $2 AND tag_id = $3`,
            [
              dominantResult.rows[0].badge_category,
              awarded_to_user_id,
              resolvedTagId,
            ],
          );
          if (process.env.NODE_ENV !== "production") {
            console.log(
              "🏅 Tag credit updated. Dominant category:",
              dominantResult.rows[0].badge_category,
            );
          }
        }

        await client.query("RELEASE SAVEPOINT tag_credit_sp");
      } catch (tagError) {
        await client.query("ROLLBACK TO SAVEPOINT tag_credit_sp");
        console.warn(
          "⚠️ Tag credit update failed (non-critical):",
          tagError.message,
        );
      }
    }

    // ── Non-critical: Create notification (SAVEPOINT) ──
    const badgeName = badgeCheck.rows[0].name;
    const awarderRow = (await client.query(
      "SELECT first_name, last_name, username FROM users WHERE id = $1",
      [req.user.id],
    )).rows[0];
    const awarderName = [awarderRow?.first_name, awarderRow?.last_name].filter(Boolean).join(" ") || awarderRow?.username || "Someone";

    let notificationCreated = false;
    try {
      await client.query("SAVEPOINT notification_sp");

      await client.query(
        `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id, team_id, actor_id)
         VALUES ($1, 'badge_awarded', $2, $3, 'badge', $4, $5, $6)`,
        [
          awarded_to_user_id,
          `New Badge: ${badgeName}`,
          `${awarderName} awarded you the "${badgeName}" badge (${credits} credit${credits > 1 ? "s" : ""})`,
          badge_id,
          team_id || null,
          awardedByUserId,
        ],
      );
      await client.query("RELEASE SAVEPOINT notification_sp");
      notificationCreated = true;
      if (process.env.NODE_ENV !== "production") {
        console.log("🏅 Notification created");
      }
    } catch (notifError) {
      await client.query("ROLLBACK TO SAVEPOINT notification_sp");
      console.warn(
        "⚠️ Notification creation failed (non-critical):",
        notifError.message,
      );
    }

    // ── Commit main transaction ──
    await client.query("COMMIT");
    if (process.env.NODE_ENV !== "production") {
      console.log(
        "🏅 ====== TRANSACTION COMMITTED ====== Award ID:",
        insertResult.rows[0].id,
      );
    }

    // Refresh materialized views (post-commit, non-blocking)
    refreshBadgeViews(pool).catch((err) =>
      console.warn("⚠️ View refresh failed:", err.message),
    );

    // Notify recipient instantly via socket
    try {
      const io = req.app.get("io");
      if (io) {
        if (notificationCreated) {
          io.to(`user:${awarded_to_user_id}`).emit("notification:new", {
            type: "badge_awarded",
          });
        }
        io.to(`user:${awarded_to_user_id}`).emit("badge:awarded", {
          badgeName,
          badgeCategory: badgeCheck.rows[0].category || null,
          awarderName,
          badgeId: badge_id,
        });
      }
    } catch (socketError) {
      console.warn("⚠️ Socket emit failed (non-critical):", socketError.message);
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("🏅 ====== AWARD BADGE COMPLETE ======");
    }

    res.status(201).json({
      success: true,
      message: "Badge awarded successfully",
      data: {
        ...insertResult.rows[0],
        hidden: true,
        hidden_award_ids: hiddenAwardsResult.rows[0]?.hidden_award_ids ?? [],
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error awarding badge:", error);
    res.status(500).json({
      success: false,
      message: "Error awarding badge",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  } finally {
    client.release();
  }
};

/**
 * @description Delete one badge award received by the authenticated user
 * @route DELETE /api/badges/awards/:awardId
 * @access Private (recipient only)
 */
const deleteBadgeAward = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;
    const awardId = req.params.awardId;

    if (!awardId) {
      return res.status(400).json({
        success: false,
        message: "awardId is required",
      });
    }

    await client.query("BEGIN");

    const awardResult = await client.query(
      `DELETE FROM badge_awards
       WHERE id = $1
         AND awarded_to_user_id = $2
       RETURNING id, awarded_to_user_id, badge_id, credits, tag_id`,
      [awardId, userId],
    );

    if (awardResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Badge award not found",
      });
    }

    const deletedAward = awardResult.rows[0];

    await recalculateUserTagBadgeCredits(
      client,
      deletedAward.awarded_to_user_id,
      deletedAward.tag_id,
    );

    await client.query("COMMIT");

    refreshBadgeViews(pool).catch((err) =>
      console.warn("⚠️ View refresh failed:", err.message),
    );

    res.status(200).json({
      success: true,
      message: "Badge award deleted successfully",
      data: deletedAward,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting badge award:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting badge award",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  } finally {
    client.release();
  }
};

/**
 * @description Get teams shared between the authenticated user and another user
 * @route GET /api/badges/shared-teams/:userId
 * @access Private (requires authentication)
 *
 * Returns active (non-archived) teams where both users are members.
 * Used by the BadgeAwardModal to populate the team context dropdown.
 */
const getSharedTeams = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const targetUserId = parseInt(req.params.userId);

    if (!targetUserId || isNaN(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid userId is required",
      });
    }

    const result = await pool.query(
      `SELECT
         t.id,
         t.name,
         t.teamavatar_url,
         t.is_remote,
         t.city,
         t.country
       FROM teams t
       JOIN team_members tm1 ON t.id = tm1.team_id AND tm1.user_id = $1
       JOIN team_members tm2 ON t.id = tm2.team_id AND tm2.user_id = $2
       WHERE t.archived_at IS NULL
       ORDER BY t.name ASC`,
      [currentUserId, targetUserId],
    );

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `🏅 Shared teams between user ${currentUserId} and ${targetUserId}: ${result.rows.length}`,
      );
    }

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching shared teams:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching shared teams",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * @description Get badges for a specific user (via badge routes)
 * @route GET /api/badges/user/:userId
 * @access Public
 */
const getUserBadges = async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await pool.query(
      `
      SELECT
        ba.id AS award_id,
        b.id AS badge_id,
        b.name AS badge_name,
        b.description AS badge_description,
        b.category AS badge_category,
        b.image_url AS badge_image_url,
        b.color AS badge_color,
        b.cat_image_url AS badge_category_image_url,
        ba.credits,
        ba.created_at AS awarded_at,
        ba.reason,
        ba.context_type,
        ba.context_id,
        ba.custom_team_name,
        ba.project_name,
        ba.team_id,
        COALESCE(t.name, ba.custom_team_name) AS team_name,
        t.is_synthetic AS team_is_synthetic,
        ba.tag_id,
        tag.name AS tag_name,
        tag.category AS tag_category,
        ba.awarded_by_user_id,
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
  getAllBadges,
  awardBadge,
  deleteBadgeAward,
  getUserBadges,
  getSharedTeams,
};
