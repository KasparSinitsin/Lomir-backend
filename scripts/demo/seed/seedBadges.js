const { awards } = require("../data/demoData");
const { DAY, TSTZ, tagId, badgeId } = require("./seedContext");

const PROJECT_NAME = "Neighbourhood data pipeline"; // for the awards of context "project"

// Badge awards, the way the app stores them: the award, then the credits on the focus area.
async function seedBadges(ctx) {
  const { client, userId, teamId } = ctx;
  const hiddenFor = new Map(); // user key -> award ids that are not shown yet
  const touched = new Map(); // "userId:tagId" -> [userId, tagId]

  for (const [to, by, badge, credits, context, teamKey, tag, reason, days, hidden] of awards) {
    if (to === by) throw new Error(`demo data: ${to} awards a badge to themselves`);
    const { rows } = await client.query(
      `INSERT INTO badge_awards (awarded_to_user_id, badge_id, awarded_by_user_id, credits, reason,
                                 context_type, team_id, tag_id, project_name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,${TSTZ(10)},${TSTZ(10)})
       RETURNING id`,
      [
        userId[to], badgeId(badge), userId[by], credits, reason, context,
        teamKey ? teamId[teamKey] : null, tag ? tagId(tag) : null,
        context === "project" ? PROJECT_NAME : null, days * DAY,
      ],
    );
    ctx.bump("badge_awards");
    ctx.awards.push({ id: rows[0].id, to, by, badge, credits, teamKey, hidden, days });
    if (hidden) hiddenFor.set(to, [...(hiddenFor.get(to) || []), rows[0].id]);
    if (tag) {
      await client.query(
        `INSERT INTO user_tags (user_id, tag_id, badge_credits, source)
         VALUES ($1,$2,$3,'award')
         ON CONFLICT (user_id, tag_id) DO UPDATE SET badge_credits = user_tags.badge_credits + $3`,
        [userId[to], tagId(tag), credits],
      );
      touched.set(`${userId[to]}:${tagId(tag)}`, [userId[to], tagId(tag)]);
    }
  }

  for (const [uid, tid] of touched.values()) {
    const dominant = await client.query(
      "SELECT badge_category FROM v_user_tag_dominant_category WHERE user_id = $1 AND tag_id = $2",
      [uid, tid],
    );
    if (dominant.rows.length > 0) {
      await client.query(
        "UPDATE user_tags SET dominant_badge_category = $1 WHERE user_id = $2 AND tag_id = $3",
        [dominant.rows[0].badge_category, uid, tid],
      );
    }
  }
  for (const [key, ids] of hiddenFor) {
    await client.query("UPDATE users SET hidden_award_ids = $1::integer[] WHERE id = $2", [ids, userId[key]]);
    ctx.bump("awards_not_shown_yet", ids.length);
  }
}

module.exports = { seedBadges, PROJECT_NAME };
