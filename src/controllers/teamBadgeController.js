const db = require("../config/database");

const isTeamVisibleToViewer = async (teamId, viewerId) => {
  const teamResult = await db.pool.query(
    'SELECT is_public, archived_at FROM teams WHERE id = $1',
    [teamId],
  );
  if (teamResult.rows.length === 0) return false;

  const team = teamResult.rows[0];

  const isMember = async () => {
    if (!viewerId) return false;
    const memberCheck = await db.pool.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, viewerId],
    );
    return memberCheck.rows.length > 0;
  };

  // Archived (deleted, scheduled-for-deletion) teams are only visible to their
  // remaining members, regardless of is_public — so the archived-team chat can
  // still show team badges to those members.
  if (team.archived_at) return isMember();

  if (team.is_public === true || team.is_public === 'true') return true;

  return isMember();
};

const getTeamBadgeAwards = async (req, res) => {
  try {
    const teamId = req.params.id;
    const viewerId = req.user?.id;

    const visible = await isTeamVisibleToViewer(teamId, viewerId);
    if (!visible) {
      return res.status(404).json({ success: false, message: "Team not found" });
    }

    const result = await db.pool.query(
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
        ba.team_id,
        COALESCE(t_ctx.name, ba.custom_team_name) AS team_name,
        t_ctx.is_synthetic AS team_is_synthetic,
        ba.tag_id,
        tag.name AS tag_name,
        tag.category AS tag_category,
        ba.awarded_by_user_id,
        awarder.username AS awarded_by_username,
        awarder.first_name AS awarded_by_first_name,
        awarder.last_name AS awarded_by_last_name,
        awarder.avatar_url AS awarded_by_avatar_url,
        awarder.is_synthetic AS awarded_by_is_synthetic,
        -- Extra: who RECEIVED the badge (needed for team context)
        ba.awarded_to_user_id,
        recipient.username AS awarded_to_username,
        recipient.first_name AS awarded_to_first_name,
        recipient.last_name AS awarded_to_last_name,
        recipient.avatar_url AS awarded_to_avatar_url,
        recipient.is_synthetic AS awarded_to_is_synthetic
      FROM badge_awards ba
      JOIN badges b ON ba.badge_id = b.id
      JOIN team_members tm ON ba.awarded_to_user_id = tm.user_id AND tm.team_id = $1
      JOIN team_tags tt ON ba.tag_id = tt.tag_id AND tt.team_id = $1
      LEFT JOIN users awarder ON ba.awarded_by_user_id = awarder.id
      LEFT JOIN users recipient ON ba.awarded_to_user_id = recipient.id
      LEFT JOIN teams t_ctx ON ba.team_id = t_ctx.id
      LEFT JOIN tags tag ON ba.tag_id = tag.id
      WHERE ba.tag_id IS NOT NULL
        AND (
          ba.awarded_to_user_id = $2
          OR NOT (ba.id = ANY(COALESCE(recipient.hidden_award_ids, '{}'::INTEGER[])))
        )
      ORDER BY ba.created_at DESC, ba.id DESC
      `,
      [teamId, viewerId || null],
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching team badge awards:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team badge awards",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

const getTeamMemberBadges = async (req, res) => {
  try {
    const teamId = req.params.id;
    const viewerId = req.user?.id;

    const visible = await isTeamVisibleToViewer(teamId, viewerId);
    if (!visible) {
      return res.status(404).json({ success: false, message: "Team not found" });
    }

    const result = await db.pool.query(
      `
      WITH badge_totals AS (
        SELECT
          b.id                          AS badge_id,
          b.name,
          b.description,
          b.category,
          b.color,
          b.image_url,
          b.cat_image_url,
          SUM(ba.credits)::int               AS total_credits,
          COUNT(ba.id)::int                   AS award_count,
          COUNT(DISTINCT ba.awarded_by_user_id)::int AS awarder_count,
          COUNT(DISTINCT ba.awarded_to_user_id)::int AS awardee_count
        FROM badge_awards ba
        JOIN badges b         ON ba.badge_id = b.id
        JOIN team_members tm  ON ba.awarded_to_user_id = tm.user_id
                             AND tm.team_id = $1
        LEFT JOIN users recipient ON recipient.id = ba.awarded_to_user_id
        WHERE (
          ba.awarded_to_user_id = $2
          OR NOT (ba.id = ANY(COALESCE(recipient.hidden_award_ids, '{}'::INTEGER[])))
        )
        GROUP BY b.id, b.name, b.description, b.category, b.color,
                 b.image_url, b.cat_image_url
      ),
      category_totals AS (
        SELECT
          category,
          SUM(total_credits)::int          AS category_total_credits,
          SUM(award_count)::int            AS category_award_count,
          SUM(awarder_count)::int          AS category_awarder_count
        FROM badge_totals
        GROUP BY category
      )
      SELECT
        bt.*,
        ct.category_total_credits,
        ct.category_award_count,
        ct.category_awarder_count
      FROM badge_totals bt
      JOIN category_totals ct ON bt.category = ct.category
      ORDER BY bt.category, bt.total_credits DESC, bt.name
      `,
      [teamId, viewerId || null],
    );

    const grandTotalCredits = result.rows.reduce(
      (sum, row) => sum + Number(row.total_credits || 0),
      0,
    );

    res.status(200).json({
      success: true,
      data: result.rows,
      meta: { totalCredits: grandTotalCredits },
    });
  } catch (error) {
    console.error("Error fetching team member badges:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team member badges",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

const getMemberBadgesForTeams = async (req, res) => {
  try {
    const rawIds = String(req.query.teamIds || "").split(",");
    const requestedIds = rawIds
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (requestedIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {},
        meta: { totalCreditsByTeam: {} },
      });
    }

    // Filter to only teams the viewer may access
    const viewerId = req.user?.id;
    const teamIds = [];
    for (const id of requestedIds) {
      const visible = await isTeamVisibleToViewer(id, viewerId);
      if (visible) teamIds.push(id);
    }

    if (teamIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {},
        meta: { totalCreditsByTeam: {} },
      });
    }

    const result = await db.pool.query(
      `
      WITH badge_totals AS (
        SELECT
          tm.team_id,
          b.id                          AS badge_id,
          b.name,
          b.description,
          b.category,
          b.color,
          b.image_url,
          b.cat_image_url,
          SUM(ba.credits)::int                       AS total_credits,
          COUNT(ba.id)::int                          AS award_count,
          COUNT(DISTINCT ba.awarded_by_user_id)::int AS awarder_count,
          COUNT(DISTINCT ba.awarded_to_user_id)::int AS awardee_count
        FROM badge_awards ba
        JOIN badges b         ON ba.badge_id = b.id
        JOIN team_members tm  ON ba.awarded_to_user_id = tm.user_id
                             AND tm.team_id = ANY($1)
        LEFT JOIN users recipient ON recipient.id = ba.awarded_to_user_id
        WHERE (
          ba.awarded_to_user_id = $2
          OR NOT (ba.id = ANY(COALESCE(recipient.hidden_award_ids, '{}'::INTEGER[])))
        )
        GROUP BY tm.team_id, b.id, b.name, b.description, b.category, b.color,
                 b.image_url, b.cat_image_url
      ),
      category_totals AS (
        SELECT
          team_id,
          category,
          SUM(total_credits)::int  AS category_total_credits,
          SUM(award_count)::int    AS category_award_count,
          SUM(awarder_count)::int  AS category_awarder_count
        FROM badge_totals
        GROUP BY team_id, category
      )
      SELECT
        bt.*,
        ct.category_total_credits,
        ct.category_award_count,
        ct.category_awarder_count
      FROM badge_totals bt
      JOIN category_totals ct
        ON bt.category = ct.category AND bt.team_id = ct.team_id
      ORDER BY bt.team_id, bt.category, bt.total_credits DESC, bt.name
      `,
      [teamIds, viewerId || null],
    );

    const dataByTeam = {};
    const totalCreditsByTeam = {};
    for (const teamId of teamIds) {
      dataByTeam[teamId] = [];
      totalCreditsByTeam[teamId] = 0;
    }
    for (const row of result.rows) {
      const teamId = row.team_id;
      if (!dataByTeam[teamId]) dataByTeam[teamId] = [];
      dataByTeam[teamId].push(row);
      totalCreditsByTeam[teamId] =
        (totalCreditsByTeam[teamId] || 0) + Number(row.total_credits || 0);
    }

    res.status(200).json({
      success: true,
      data: dataByTeam,
      meta: { totalCreditsByTeam },
    });
  } catch (error) {
    console.error("Error fetching bulk team member badges:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching bulk team member badges",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

const getTeamMemberBadgeAwards = async (req, res) => {
  try {
    const teamId = req.params.id;
    const viewerId = req.user?.id;

    const visible = await isTeamVisibleToViewer(teamId, viewerId);
    if (!visible) {
      return res.status(404).json({ success: false, message: "Team not found" });
    }

    const result = await db.pool.query(
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
        COALESCE(t_ctx.name, ba.custom_team_name) AS team_name,
        ba.tag_id,
        tag.name AS tag_name,
        tag.category AS tag_category,
        ba.awarded_by_user_id,
        awarder.username AS awarded_by_username,
        awarder.first_name AS awarded_by_first_name,
        awarder.last_name AS awarded_by_last_name,
        awarder.avatar_url AS awarded_by_avatar_url,
        awarder.is_synthetic AS awarded_by_is_synthetic,
        ba.awarded_to_user_id,
        recipient.username AS awarded_to_username,
        recipient.first_name AS awarded_to_first_name,
        recipient.last_name AS awarded_to_last_name,
        recipient.avatar_url AS awarded_to_avatar_url,
        recipient.is_synthetic AS awarded_to_is_synthetic
      FROM badge_awards ba
      JOIN badges b ON ba.badge_id = b.id
      JOIN team_members tm ON ba.awarded_to_user_id = tm.user_id AND tm.team_id = $1
      LEFT JOIN users awarder ON ba.awarded_by_user_id = awarder.id
      LEFT JOIN users recipient ON ba.awarded_to_user_id = recipient.id
      LEFT JOIN teams t_ctx ON ba.team_id = t_ctx.id
      LEFT JOIN tags tag ON ba.tag_id = tag.id
      WHERE (
        ba.awarded_to_user_id = $2
        OR NOT (ba.id = ANY(COALESCE(recipient.hidden_award_ids, '{}'::INTEGER[])))
      )
      ORDER BY ba.created_at DESC, ba.id DESC
      `,
      [teamId, viewerId || null],
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching team member badge awards:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team member badge awards",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

module.exports = {
  getTeamBadgeAwards,
  getTeamMemberBadges,
  getMemberBadgesForTeams,
  getTeamMemberBadgeAwards,
};
