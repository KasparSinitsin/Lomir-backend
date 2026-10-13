const { pool } = require("../config/database");
const {
  ensureBadgeVisibilityColumns,
  visibleAwardCondition,
  visibleFocusAreaCondition,
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
        -- Which kind of focus area this is. The owner's own views need it: a
        -- self-chosen one shows even while its only award is hidden, an
        -- award-created one does not exist until that award does. A stranger
        -- never sees the second kind at all, so for them this is redundant —
        -- it is sent either way to keep one payload shape.
        ut.source,
        COALESCE(tag_award_stats.badge_credits, 0)::INT AS badge_credits,
        tag_award_stats.dominant_badge_category,
        COALESCE(tag_award_stats.linked_badge_count, 0)::INT AS linked_badge_count,
        COALESCE(tag_award_stats.awarder_count, 0)::INT AS awarder_count,
        COALESCE(tag_award_stats.hidden_badge_credits, 0)::INT AS hidden_badge_credits,
        COALESCE(tag_award_stats.hidden_linked_badge_count, 0)::INT AS hidden_linked_badge_count
      FROM user_tags ut
      JOIN users u ON u.id = ut.user_id
      JOIN tags t ON ut.tag_id = t.id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(ba.credits) FILTER (WHERE ba_shown), 0)::INT AS badge_credits,
          COUNT(*) FILTER (WHERE ba_shown)::INT AS linked_badge_count,
          COUNT(DISTINCT ba.awarded_by_user_id) FILTER (WHERE ba_shown)::INT AS awarder_count,
          COALESCE(SUM(ba.credits) FILTER (WHERE NOT ba_shown), 0)::INT AS hidden_badge_credits,
          COUNT(*) FILTER (WHERE NOT ba_shown)::INT AS hidden_linked_badge_count,
          (
            SELECT b2.category
            FROM badge_awards ba2
            JOIN badges b2 ON b2.id = ba2.badge_id
            WHERE ba2.tag_id = t.id
              AND ba2.awarded_to_user_id = ut.user_id
              AND ${visibleAwardCondition({
                awardAlias: "ba2",
                userAlias: "u",
              })}
            GROUP BY b2.category
            ORDER BY SUM(ba2.credits) DESC, b2.category ASC
            LIMIT 1
          ) AS dominant_badge_category
        FROM badge_awards ba
        CROSS JOIN LATERAL (
          SELECT ${visibleAwardCondition({
            awardAlias: "ba",
            userAlias: "u",
          })} AS ba_shown
        ) shown_flag
        WHERE ba.tag_id = t.id
          AND ba.awarded_to_user_id = ut.user_id
          AND ${visibleAwardCondition({
            awardAlias: "ba",
            userAlias: "u",
            viewerIsOwnerExpr: "$2::BOOLEAN",
          })}
      ) tag_award_stats ON TRUE
      WHERE ut.user_id = $1
        AND ${visibleFocusAreaCondition({
          userAlias: "u",
          tagAlias: "t",
          linkAlias: "ut",
          viewerIsOwnerExpr: "$2::BOOLEAN",
        })}
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
            hidden_badge_credits: 0,
            hidden_linked_badge_count: 0,
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

    // Replace the user's OWN focus areas, and only those.
    // 🔴 **This used to delete every row and re-insert the submitted list**,
    // which is how the distinction between a chosen focus area and one an award
    // created was destroyed: the form shows both, so saving the profile silently
    // adopted the award-created ones as the user's, permanently and with the
    // default levels stamped on. Measured on user 374, 2026-09-28 — all three of
    // their focus areas carried `interest 3 / experience 2`.
    // `'award'` rows are not the user's list and are left where they are;
    // `badgeController` owns them.
    await client.query(
      "DELETE FROM user_tags WHERE user_id = $1 AND source = 'user'",
      [userId],
    );

    // Insert new tags
    if (tags && tags.length > 0) {
      const tagInserts = tags.map((tag) =>
        client.query(
          `
          INSERT INTO user_tags (user_id, tag_id, experience_level, interest_level, badge_credits, dominant_badge_category, source)
          VALUES ($1, $2, $3, $4, $5, $6, 'user')
          -- A submitted tag that already exists as 'award' becomes the user's.
          -- The form no longer offers the award-created ones, so putting one in
          -- the list is a deliberate claim: they are saying this is theirs, and
          -- it should stop depending on whether that badge is shown.
          ON CONFLICT (user_id, tag_id) DO UPDATE SET
            experience_level = EXCLUDED.experience_level,
            interest_level = EXCLUDED.interest_level,
            source = 'user'
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
  ut.source,
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

    // ✅ **Visibility does not change `user_tags.source`. Julia, 2026-09-29 —
    // asked, weighed, decided against.** The obvious-looking improvement is to
    // promote an award-created focus area to `'user'` when its award is made
    // visible, on the grounds that showing a badge is how you confirm it. It
    // was rejected because it breaks the retraction: once promoted, hiding the
    // award again would leave the focus area standing, and "a hidden award
    // takes its focus area with it" (BE #336) would no longer hold for that
    // path. Doing it symmetrically instead — promote on show, demote on hide —
    // needs a third `source` value, because a plain demotion would also strip
    // focus areas the user chose themselves, which is the exact defect this
    // column was added to remove.
    // ⚠️ The known cost, accepted: an award-created focus area cannot be
    // removed in the profile editor. It belongs to its award, and the levers
    // are the award's — hide it, and the focus area goes with it; delete it,
    // and the row goes too.
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
        -- the id lets the client show the focus area in the set language; it
        -- keeps using the stored name to match and group
        ba.tag_id,
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
        AND ${visibleAwardCondition({
          awardAlias: "ba",
          userAlias: "awardee",
          viewerIsOwnerExpr: "$2::BOOLEAN",
        })}
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
