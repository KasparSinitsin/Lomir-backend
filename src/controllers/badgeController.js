const { pool } = require("../config/database");

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
      error: error.message,
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
      console.log(`🏅 Refreshed materialized view: ${viewName}`);
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
 *     context_type: string (optional, e.g. "team", "project", "profile"),
 *     context_id: number (optional),
 *     team_id: number (optional)
 *   }
 */
const awardBadge = async (req, res) => {
  const client = await pool.connect();

  try {
    const awardedByUserId = req.user.id; // From auth middleware

    console.log("🏅 ====== AWARD BADGE CALLED ======");
    console.log("🏅 req.user.id:", awardedByUserId);
    console.log("🏅 req.body:", JSON.stringify(req.body, null, 2));

    const {
      awarded_to_user_id,
      badge_id,
      credits,
      reason,
      context_type,
      context_id,
      team_id,
    } = req.body;

    // ── Validation ──
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

    // Verify badge exists
    const badgeCheck = await client.query(
      "SELECT id, name, category FROM badges WHERE id = $1",
      [badge_id],
    );
    if (badgeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Badge not found",
      });
    }
    console.log("🏅 Badge found:", badgeCheck.rows[0].name);

    // Verify target user exists
    const userCheck = await client.query(
      "SELECT id, first_name, last_name, username FROM users WHERE id = $1",
      [awarded_to_user_id],
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Target user not found",
      });
    }
    console.log("🏅 Target user:", userCheck.rows[0].username);

    // ── Insert award (main transaction) ──
    await client.query("BEGIN");

    const insertResult = await client.query(
      `INSERT INTO badge_awards
         (awarded_to_user_id, badge_id, awarded_by_user_id, credits, reason, context_type, context_id, team_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [
        awarded_to_user_id,
        badge_id,
        awardedByUserId,
        Number(credits),
        reason || null,
        context_type || "profile",
        context_id || null,
        team_id || null,
      ],
    );

    console.log("🏅 badge_awards INSERT success! ID:", insertResult.rows[0].id);

    // ── user_badges update (non-critical, wrapped in SAVEPOINT) ──
    try {
      await client.query("SAVEPOINT user_badges_sp");
      await client.query(
        `INSERT INTO user_badges (user_id, badge_id, awarded_by, awarded_at, team_id)
         VALUES ($1, $2, $3, NOW(), $4)`,
        [awarded_to_user_id, badge_id, awardedByUserId, team_id || null],
      );
      await client.query("RELEASE SAVEPOINT user_badges_sp");
      console.log("🏅 user_badges INSERT OK");
    } catch (ubError) {
      // Roll back only this savepoint — main transaction stays intact
      await client.query("ROLLBACK TO SAVEPOINT user_badges_sp");
      console.warn(
        "⚠️ user_badges INSERT failed (non-critical):",
        ubError.message,
      );
    }

    // ── Notification (non-critical, wrapped in SAVEPOINT) ──
    try {
      await client.query("SAVEPOINT notification_sp");

      const badge = badgeCheck.rows[0];
      const awarderResult = await client.query(
        "SELECT first_name, last_name, username FROM users WHERE id = $1",
        [awardedByUserId],
      );
      const awarder = awarderResult.rows[0];
      const awarderName = awarder
        ? `${awarder.first_name || ""} ${awarder.last_name || ""}`.trim() ||
          awarder.username
        : "Someone";

      await client.query(
        `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id, actor_id, team_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          awarded_to_user_id,
          "badge_awarded",
          `New Badge: ${badge.name}`,
          `${awarderName} awarded you the ${badge.name} badge (+${credits} ct.)${reason ? `: "${reason}"` : ""}`,
          "badge_award",
          insertResult.rows[0].id,
          awardedByUserId,
          team_id || null,
        ],
      );
      await client.query("RELEASE SAVEPOINT notification_sp");
      console.log("🏅 Notification created for user", awarded_to_user_id);
    } catch (notifError) {
      await client.query("ROLLBACK TO SAVEPOINT notification_sp");
      console.warn(
        "⚠️ Notification failed (non-critical):",
        notifError.message,
      );
    }

    // ── COMMIT the transaction ──
    await client.query("COMMIT");
    console.log(
      "🏅 ====== TRANSACTION COMMITTED ====== Award ID:",
      insertResult.rows[0].id,
    );

    // ── Refresh materialized views (outside transaction, use pool not client) ──
    try {
      await refreshBadgeViews(pool);
    } catch (refreshError) {
      console.warn("⚠️ View refresh warning:", refreshError.message);
    }

    console.log("🏅 ====== AWARD BADGE COMPLETE ======");

    res.status(201).json({
      success: true,
      message: "Badge awarded successfully",
      data: insertResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error awarding badge:", error);
    res.status(500).json({
      success: false,
      message: "Error awarding badge",
      error: error.message,
    });
  } finally {
    client.release();
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
        ba.team_id,
        t.name AS team_name,
        ba.awarded_by_user_id,
        awarder.username AS awarded_by_username,
        awarder.first_name AS awarded_by_first_name,
        awarder.last_name AS awarded_by_last_name,
        awarder.avatar_url AS awarded_by_avatar_url
      FROM badge_awards ba
      JOIN badges b ON ba.badge_id = b.id
      LEFT JOIN users awarder ON ba.awarded_by_user_id = awarder.id
      LEFT JOIN teams t ON ba.team_id = t.id
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
  getAllBadges,
  awardBadge,
  getUserBadges,
};
