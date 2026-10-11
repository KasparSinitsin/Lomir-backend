const { teams, applications, invitations, CITIES } = require("../data/demoData");
const {
  DAY, TS, TSN, tagId, badgeId, teamCreatedAgo,
  applicationCreatedAgo, applicationReviewedAgo, invitationCreatedAgo, invitationAnsweredAgo,
} = require("./seedContext");

// Teams with their members, roles in every state, and the applications and invitations around them.
async function seedTeams(ctx) {
  const { client } = ctx;

  for (const team of teams) {
    const city = CITIES[team.city];
    const created = teamCreatedAgo(team.key);
    const { rows } = await client.query(
      `INSERT INTO teams (name, description, owner_id, status, postal_code, latitude, longitude, max_members,
                          is_public, city, country, state, district, is_remote, is_synthetic,
                          archived_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DE',$11,$12,$13,true,
               ${TSN(14)},${TS(15)},${TS(15)})
       RETURNING id`,
      [
        team.name, team.description, ctx.userId[team.owner], team.archived ? "inactive" : "active",
        city.postal, city.lat, city.lon, team.max, team.isPublic !== false, team.city,
        city.state, city.district, team.remote, team.archived ? 3 * DAY : null, created,
      ],
    );
    const teamId = rows[0].id;
    ctx.teamId[team.key] = teamId;
    ctx.bump("teams");

    const members = [[team.owner, "owner"], ...team.admins.map((k) => [k, "admin"]), ...team.members.map((k) => [k, "member"])];
    for (const [index, [key, role]] of members.entries()) {
      await client.query(
        `INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES ($1,$2,$3,${TS(4)})`,
        [teamId, ctx.userId[key], role, created - index * DAY],
      );
      ctx.bump("team_members");
    }

    for (const name of team.tags) {
      await client.query("INSERT INTO team_tags (team_id, tag_id) VALUES ($1,$2)", [teamId, tagId(name)]);
      ctx.bump("team_tags");
    }

    for (const [index, role] of team.roles.entries()) {
      const roleRows = await client.query(
        `INSERT INTO team_vacant_roles (team_id, created_by, role_name, bio, postal_code, city, country, state,
                                        district, latitude, longitude, max_distance_km, is_remote, status,
                                        filled_by, is_synthetic, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'DE',$7,$8,$9,$10,$11,$12,$13,$14,true,${TS(15)},${TS(15)})
         RETURNING id`,
        [
          teamId, ctx.userId[team.owner], role.name, role.bio, city.postal, team.city, city.state, city.district,
          city.lat, city.lon, team.remote ? null : 30, team.remote, role.status,
          role.filledBy ? ctx.userId[role.filledBy] : null, created - (index + 1) * DAY,
        ],
      );
      const roleId = roleRows.rows[0].id;
      ctx.roleId[`${team.key}:${index}`] = roleId;
      ctx.bump("team_vacant_roles");
      for (const name of role.tags) {
        await client.query("INSERT INTO team_vacant_role_tags (role_id, tag_id) VALUES ($1,$2)", [roleId, tagId(name)]);
        ctx.bump("team_vacant_role_tags");
      }
      for (const name of role.badges) {
        await client.query("INSERT INTO team_vacant_role_badges (role_id, badge_id) VALUES ($1,$2)", [roleId, badgeId(name)]);
        ctx.bump("team_vacant_role_badges");
      }
    }
  }

  // The open role of a team, for an application that names a role.
  const openRoleOf = (teamKey) => {
    const index = teams.find((t) => t.key === teamKey).roles.findIndex((r) => r.status === "open");
    return index < 0 ? null : ctx.roleId[`${teamKey}:${index}`];
  };

  for (const [index, [applicant, teamKey, status, message, forOpenRole]] of applications.entries()) {
    const team = teams.find((t) => t.key === teamKey);
    const decided = status !== "pending";
    const { rows } = await client.query(
      `INSERT INTO team_applications (team_id, applicant_id, message, status, role_id, reviewed_by,
                                      created_at, updated_at, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,${TS(7)},${TS(7)},${TSN(8)})
       RETURNING id`,
      [
        ctx.teamId[teamKey], ctx.userId[applicant], message, status, forOpenRole ? openRoleOf(teamKey) : null,
        decided ? ctx.userId[team.owner] : null, applicationCreatedAgo(index), decided ? applicationReviewedAgo(index) : null,
      ],
    );
    ctx.applicationId[`${applicant}:${teamKey}`] = rows[0].id;
    ctx.bump("team_applications");
  }

  for (const [index, [inviter, invitee, teamKey, status, message]] of invitations.entries()) {
    const answered = status !== "pending";
    const { rows } = await client.query(
      `INSERT INTO team_invitations (team_id, inviter_id, invitee_id, message, status, created_at, responded_at)
       VALUES ($1,$2,$3,$4,$5,${TS(6)},${TSN(7)})
       RETURNING id`,
      [ctx.teamId[teamKey], ctx.userId[inviter], ctx.userId[invitee], message, status, invitationCreatedAgo(index), answered ? invitationAnsweredAgo(index) : null],
    );
    ctx.invitationId[`${invitee}:${teamKey}`] = rows[0].id;
    ctx.bump("team_invitations");
  }
}

module.exports = { seedTeams };
