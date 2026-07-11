const { pool } = require("../config/database");
const {
  ensureBadgeVisibilityColumns,
} = require("../utils/badgeVisibilityUtils");

/**
 * @description Get tags for a specific user
 * @route GET /api/users/:id/tags
 * @access Public, with optional auth for own-profile hidden award visibility
 */
const getUserTags = async (req, res) => {
  try {
    const userId = req.params.id;
    const canViewHiddenAwards = Number(req.user?.id) === Number(userId);

    const userVisibility = await pool.query(
      `SELECT id, is_public, COALESCE(hide_badges, FALSE) AS hide_badges
       FROM users
       WHERE id = $1`,
      [userId],
    );

    if (userVisibility.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const userRow = userVisibility.rows[0];
    const userIsPublic =
      userRow.is_public === true || userRow.is_public === "true";

    if (!canViewHiddenAwards && !userIsPublic) {
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
        return res.status(404).json({ success: false, message: "User not found" });
      }
    }

    await ensureBadgeVisibilityColumns();

    const result = await pool.query(
      `
      SELECT
        t.id,
        t.name,
        t.category,
        t.supercategory,
        ut.experience_level,
        ut.interest_level,
        COALESCE(tag_award_stats.badge_credits, 0)::INT AS badge_credits,
        tag_award_stats.dominant_badge_category,
        COALESCE(tag_award_stats.linked_badge_count, 0)::INT AS linked_badge_count,
        COALESCE(tag_award_stats.awarder_count, 0)::INT AS awarder_count
      FROM user_tags ut
      JOIN users u ON u.id = ut.user_id
      JOIN tags t ON ut.tag_id = t.id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(ba.credits), 0)::INT AS badge_credits,
          COUNT(*)::INT AS linked_badge_count,
          COUNT(DISTINCT ba.awarded_by_user_id)::INT AS awarder_count,
          (
            SELECT b2.category
            FROM badge_awards ba2
            JOIN badges b2 ON b2.id = ba2.badge_id
            WHERE ba2.tag_id = t.id
              AND ba2.awarded_to_user_id = ut.user_id
              AND (
                $2::BOOLEAN = TRUE
                OR COALESCE(u.hide_badges, FALSE) = TRUE
                OR NOT (ba2.id = ANY(COALESCE(u.hidden_award_ids, '{}'::INTEGER[])))
              )
            GROUP BY b2.category
            ORDER BY SUM(ba2.credits) DESC, b2.category ASC
            LIMIT 1
          ) AS dominant_badge_category
        FROM badge_awards ba
        WHERE ba.tag_id = t.id
          AND ba.awarded_to_user_id = ut.user_id
          AND (
            $2::BOOLEAN = TRUE
            OR COALESCE(u.hide_badges, FALSE) = TRUE
            OR NOT (ba.id = ANY(COALESCE(u.hidden_award_ids, '{}'::INTEGER[])))
          )
      ) tag_award_stats ON TRUE
      WHERE ut.user_id = $1
    `,
      [userId, canViewHiddenAwards],
    );

    res.status(200).json({
      success: true,
      data: userRow.hide_badges && !canViewHiddenAwards
        ? result.rows.map((row) => ({
            ...row,
            badge_credits: 0,
            dominant_badge_category: null,
            linked_badge_count: 0,
            awarder_count: 0,
          }))
        : result.rows,
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

const updateUserBadgeVisibility = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const awardId = Number(req.params.awardId);
    const hidden = req.body?.hidden !== false;

    if (!Number.isFinite(userId) || !Number.isFinite(awardId)) {
      return res.status(400).json({
        success: false,
        message: "Valid user ID and award ID are required",
      });
    }

    if (Number(req.user.id) !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only update badge visibility on your own profile",
      });
    }

    await ensureBadgeVisibilityColumns();

    const awardResult = await pool.query(
      `SELECT id, badge_id
       FROM badge_awards
       WHERE id = $1
         AND awarded_to_user_id = $2
       LIMIT 1`,
      [awardId, userId],
    );

    if (awardResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Badge award not found",
      });
    }

    const result = await pool.query(
      hidden
        ? `UPDATE users
           SET hidden_award_ids = (
                 SELECT ARRAY(
                   SELECT DISTINCT value
                   FROM unnest(COALESCE(hidden_award_ids, '{}'::INTEGER[]) || $2::INTEGER) AS hidden_ids(value)
                   ORDER BY value
                 )
               ),
               updated_at = NOW()
           WHERE id = $1
           RETURNING hidden_award_ids`
        : `UPDATE users
           SET hidden_award_ids = array_remove(COALESCE(hidden_award_ids, '{}'::INTEGER[]), $2::INTEGER),
               updated_at = NOW()
           WHERE id = $1
           RETURNING hidden_award_ids`,
      [userId, awardId],
    );

    res.status(200).json({
      success: true,
      message: hidden
        ? "Badge hidden successfully"
        : "Badge made visible successfully",
      data: {
        awardId,
        badgeId: awardResult.rows[0].badge_id,
        hidden,
        hiddenAwardIds: result.rows[0]?.hidden_award_ids ?? [],
      },
    });
  } catch (error) {
    console.error("Error updating badge visibility:", error);
    res.status(500).json({
      success: false,
      message: "Error updating badge visibility",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
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
    const canViewHiddenAwards = Number(req.user?.id) === Number(userId);

    const userVisibility = await pool.query(
      `SELECT id, is_public, COALESCE(hide_badges, FALSE) AS hide_badges
       FROM users
       WHERE id = $1`,
      [userId],
    );

    if (userVisibility.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const userRow = userVisibility.rows[0];
    const userIsPublic =
      userRow.is_public === true || userRow.is_public === "true";

    if (!canViewHiddenAwards && !userIsPublic) {
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
        return res.status(404).json({ success: false, message: "User not found" });
      }
    }

    if (!canViewHiddenAwards && userRow.hide_badges) {
      return res.status(200).json({ success: true, data: [] });
    }

    await ensureBadgeVisibilityColumns();

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
        awarder.avatar_url AS awarded_by_avatar_url,
        awarder.is_synthetic AS awarded_by_is_synthetic

      FROM badge_awards ba
      JOIN badges b ON ba.badge_id = b.id
      LEFT JOIN users awarder ON ba.awarded_by_user_id = awarder.id
      LEFT JOIN teams t ON ba.team_id = t.id
      LEFT JOIN tags tag ON ba.tag_id = tag.id
      LEFT JOIN users awardee ON awardee.id = ba.awarded_to_user_id
      WHERE ba.awarded_to_user_id = $1
        AND (
          $2::BOOLEAN = TRUE
          OR NOT (ba.id = ANY(COALESCE(awardee.hidden_award_ids, '{}'::INTEGER[])))
        )
      ORDER BY ba.created_at DESC, ba.id DESC
      `,
      [userId, canViewHiddenAwards],
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
  getUserTags,
  updateUserTags,
  updateUserBadgeVisibility,
  getUserBadges,
};
