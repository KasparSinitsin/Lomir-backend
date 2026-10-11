/**
 * Writes the invented world of demoData.js into a database that has the structure and the
 * reference data (`npm run db:setup`) and no users yet.
 *
 * It only INSERTS. It contains no DELETE, TRUNCATE, DROP or ALTER, and a test keeps it so.
 * The caller (scripts/seed-demo.js) checks that the database is local and has no users.
 */
const { CITIES, users, teams, applications, invitations, awards, messages } = require("./demoData");
const taxonomy = require("../reference/taxonomy.json");
const { badges } = require("../reference/badges.json");
const {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_AGE_CONFIRMATION_VERSION,
} = require("../../config/legalDocuments");

const PROJECT_NAME = "Neighbourhood data pipeline"; // for the awards of context "project"
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

// Times are worked out in the database, from "milliseconds ago", so each column gets its own type:
// `timestamp` columns hold UTC (that is how the app reads them), `timestamptz` columns an instant.
const TS = (p) => `((NOW() AT TIME ZONE 'UTC') - ($${p}::double precision * interval '1 millisecond'))`;
const TSTZ = (p) => `(NOW() - ($${p}::double precision * interval '1 millisecond'))`;

// name -> id, and a loud failure for a name that is missing or not unique.
const lookup = (rows, kind) => {
  const byName = new Map();
  for (const row of rows) byName.set(row.name, [...(byName.get(row.name) || []), row.id]);
  return (name) => {
    const ids = byName.get(name);
    if (!ids) throw new Error(`demo data: no ${kind} named "${name}"`);
    if (ids.length > 1) throw new Error(`demo data: the ${kind} name "${name}" is not unique`);
    return ids[0];
  };
};
const tagId = lookup(taxonomy.tags, "tag");
const badgeId = lookup(badges, "badge");

async function seedDemo(client, { passwordHash }) {
  const counts = {};
  const bump = (name, n = 1) => (counts[name] = (counts[name] || 0) + n);
  const userId = {};
  const teamId = {};
  const roleId = {};

  // ---- people
  for (const [index, user] of users.entries()) {
    const city = CITIES[user.city];
    const { rows } = await client.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, bio,
                          postal_code, latitude, longitude, city, state, country,
                          is_public, email_verified, is_synthetic, preferred_language,
                          accepted_terms_at, accepted_privacy_at, confirmed_age_16_at,
                          accepted_terms_version, accepted_privacy_version, confirmed_age_16_version,
                          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DE',true,true,true,$12,
               ${TSTZ(13)},${TSTZ(13)},${TSTZ(13)},$14,$15,$16,${TS(13)},${TS(13)})
       RETURNING id`,
      [
        `demo_${user.key}`, `demo.${user.key}@example.com`, passwordHash, user.first, user.last, user.bio,
        city.postal, city.lat, city.lon, user.city, city.state, user.lang,
        (40 + index) * DAY,
        CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION, CURRENT_AGE_CONFIRMATION_VERSION,
      ],
    );
    userId[user.key] = rows[0].id;
    bump("users");

    for (const [name, interest, experience] of user.tags) {
      await client.query(
        `INSERT INTO user_tags (user_id, tag_id, interest_level, experience_level, source)
         VALUES ($1, $2, $3, $4, 'user')`,
        [userId[user.key], tagId(name), interest, experience],
      );
      bump("user_tags");
    }
  }

  // ---- teams, members, tags and one open role each
  for (const [index, team] of teams.entries()) {
    const city = CITIES[team.city];
    const created = (30 - index * 3) * DAY; // milliseconds ago
    const { rows } = await client.query(
      `INSERT INTO teams (name, description, owner_id, is_public, max_members, is_remote,
                          postal_code, city, state, country, latitude, longitude,
                          status, is_synthetic, created_at, updated_at)
       VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,'DE',$9,$10,'active',true,${TS(11)},${TS(11)})
       RETURNING id`,
      [team.name, team.description, userId[team.owner], team.max, team.remote,
       city.postal, team.city, city.state, city.lat, city.lon, created],
    );
    teamId[team.key] = rows[0].id;
    bump("teams");

    const members = [
      [team.owner, "owner"],
      ...team.admins.map((key) => [key, "admin"]),
      ...team.members.map((key) => [key, "member"]),
    ];
    for (const [key, role] of members) {
      await client.query(
        `INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES ($1,$2,$3,${TS(4)})`,
        [teamId[team.key], userId[key], role, created],
      );
      bump("team_members");
    }
    for (const name of team.tags) {
      await client.query("INSERT INTO team_tags (team_id, tag_id) VALUES ($1,$2)", [teamId[team.key], tagId(name)]);
      bump("team_tags");
    }

    const role = await client.query(
      `INSERT INTO team_vacant_roles (team_id, created_by, role_name, bio, postal_code, city, country, state,
                                      latitude, longitude, max_distance_km, is_remote, status, is_synthetic,
                                      created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'DE',$7,$8,$9,$10,$11,'open',true,${TS(12)},${TS(12)})
       RETURNING id`,
      [teamId[team.key], userId[team.owner], team.role.name, team.role.bio, city.postal, team.city,
       city.state, city.lat, city.lon, team.remote ? null : 50, team.remote, created],
    );
    roleId[team.key] = role.rows[0].id;
    bump("team_vacant_roles");
    for (const name of team.role.tags) {
      await client.query("INSERT INTO team_vacant_role_tags (role_id, tag_id) VALUES ($1,$2)", [roleId[team.key], tagId(name)]);
      bump("team_vacant_role_tags");
    }
    for (const name of team.role.badges) {
      await client.query("INSERT INTO team_vacant_role_badges (role_id, badge_id) VALUES ($1,$2)", [roleId[team.key], badgeId(name)]);
      bump("team_vacant_role_badges");
    }
  }

  // ---- applications and invitations
  for (const [applicant, teamKey, status, message] of applications) {
    const owner = teams.find((t) => t.key === teamKey).owner;
    const decided = status === "pending" ? null : 2 * DAY; // milliseconds ago, or null
    await client.query(
      `INSERT INTO team_applications (team_id, applicant_id, message, status, created_at, updated_at,
                                      reviewed_at, reviewed_by, role_id)
       VALUES ($1,$2,$3,$4,${TS(5)},${TS(5)},${TS(6)},$7,$8)`,
      [teamId[teamKey], userId[applicant], message, status, 3 * DAY, decided,
       decided ? userId[owner] : null, roleId[teamKey]],
    );
    bump("team_applications");
  }
  for (const [inviter, invitee, teamKey, status, message] of invitations) {
    await client.query(
      `INSERT INTO team_invitations (team_id, inviter_id, invitee_id, message, status, created_at, responded_at)
       VALUES ($1,$2,$3,$4,$5,${TS(6)},${TS(7)})`,
      [teamId[teamKey], userId[inviter], userId[invitee], message, status, 4 * DAY,
       status === "pending" ? null : 3 * DAY],
    );
    bump("team_invitations");
  }

  // ---- badge awards, the way the app stores them: the award, then the credits on the focus area
  const hiddenFor = new Map(); // user key -> award ids that are not shown yet
  const touched = new Map(); // "userId:tagId" -> [userId, tagId]
  for (const [to, by, badge, credits, context, teamKey, tag, reason, days, hidden] of awards) {
    if (to === by) throw new Error(`demo data: ${to} awards a badge to themselves`);
    const { rows } = await client.query(
      `INSERT INTO badge_awards (awarded_to_user_id, badge_id, awarded_by_user_id, credits, reason,
                                 context_type, team_id, tag_id, project_name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,${TSTZ(10)},${TSTZ(10)})
       RETURNING id`,
      [userId[to], badgeId(badge), userId[by], credits, reason, context,
       teamKey ? teamId[teamKey] : null, tag ? tagId(tag) : null,
       context === "project" ? PROJECT_NAME : null, days * DAY],
    );
    bump("badge_awards");
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
    bump("awards_not_shown_yet", ids.length);
  }

  // ---- chat
  for (const [from, to, teamKey, text, minutesAgo] of messages) {
    const sent = minutesAgo * MINUTE; // milliseconds ago
    const read = to && minutesAgo > 100 ? sent - 5 * MINUTE : null; // a direct message is read five minutes later
    await client.query(
      `INSERT INTO messages (sender_id, receiver_id, team_id, content, sent_at, read_at)
       VALUES ($1,$2,$3,$4,${TSTZ(5)},${TSTZ(6)})`,
      [userId[from], to ? userId[to] : null, teamKey ? teamId[teamKey] : null, text, sent, read],
    );
    bump("messages");
  }

  await client.query("REFRESH MATERIALIZED VIEW public.v_user_badges_with_category_totals");
  return counts;
}

module.exports = { seedDemo, PROJECT_NAME };
