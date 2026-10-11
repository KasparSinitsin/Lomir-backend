const { messages } = require("../data/demoChat");
const { teams, applications } = require("../data/demoData");
const {
  MINUTE, HOUR, TSTZ, TSTZN, fullName, teamName, teamCreatedAgo, applicationReviewedAgo,
} = require("./seedContext");

const FIVE_MINUTES = 5 * MINUTE;

// One row in `messages`. Times are "ms ago"; a read time of null leaves the message unread.
async function insertMessage(ctx, { from, to = null, team = null, content, ago, readAgo = null, editedAgo = null, deletedAgo = null, replyTo = null }) {
  const { rows } = await ctx.client.query(
    `INSERT INTO messages (sender_id, receiver_id, team_id, content, sent_at, read_at,
                           edited_at, edited_by, deleted_at, deleted_by, reply_to_id)
     VALUES ($1,$2,$3,$4,${TSTZ(5)},${TSTZN(6)},
             ${TSTZN(7)},$8,${TSTZN(9)},$10,$11)
     RETURNING id`,
    [
      ctx.userId[from], to ? ctx.userId[to] : null, team ? ctx.teamId[team] : null, content, ago,
      readAgo, editedAgo, editedAgo == null ? null : ctx.userId[from],
      deletedAgo, deletedAgo == null ? null : ctx.userId[from], replyTo,
    ],
  );
  ctx.bump("messages");
  return rows[0].id;
}

async function markRead(ctx, messageId, readers, sentAgo) {
  for (const key of readers) {
    await ctx.client.query(
      `INSERT INTO message_reads (message_id, user_id, read_at) VALUES ($1,$2,${TSTZ(3)})`,
      [messageId, ctx.userId[key], Math.max(sentAgo - FIVE_MINUTES, MINUTE)],
    );
    ctx.bump("message_reads");
  }
}

// The people who can read a team's chat today.
const membersOf = (team) => [team.owner, ...team.admins, ...team.members];

// `{@key}` becomes the mention the app writes: @[Full Name](id).
const withMentions = (ctx, text) =>
  text.replace(/\{@(\w+)\}/g, (_, key) => `@[${fullName(key)}](${ctx.userId[key]})`);

// The banners the app writes itself, in the formats it uses, and the free-text conversation.
async function seedChat(ctx) {
  // ---- team banners: role events, someone leaving, someone accepted
  for (const team of teams) {
    const created = teamCreatedAgo(team.key);
    const events = [];
    team.roles.forEach((role, index) => {
      const roleAgo = created - (index + 1) * 24 * HOUR;
      const roleToken = `${ctx.roleId[`${team.key}:${index}`]}:${role.name}`;
      const teamToken = `${ctx.teamId[team.key]}:${team.name}`;
      const owner = `${ctx.userId[team.owner]}:${fullName(team.owner)}`;
      events.push({ from: team.owner, ago: roleAgo, content: `🆕 ROLE_CREATED: ${teamToken} | ${roleToken} | ${owner}` });
      if (role.status === "filled") {
        const filled = `${ctx.userId[role.filledBy]}:${fullName(role.filledBy)}`;
        events.push({ from: team.owner, ago: roleAgo - HOUR, content: `✅ ROLE_FILLED: ${teamToken} | ${roleToken} | ${filled} | ${owner}` });
      }
      if (role.status === "closed") {
        events.push({ from: team.owner, ago: roleAgo - 2 * HOUR, content: `🔒 ROLE_CLOSED: ${teamToken} | ${roleToken} | ${owner}` });
      }
    });
    for (const leaver of team.left) {
      events.push({ from: leaver, ago: created - 14 * 24 * HOUR, content: `🚪 MEMBER_LEFT:${ctx.userId[leaver]}:${fullName(leaver)}` });
    }
    for (const [index, event] of events.entries()) {
      const id = await insertMessage(ctx, { ...event, team: team.key });
      ctx.bannerId[`${team.key}:${index}`] = id;
      await markRead(ctx, id, membersOf(team).filter((k) => k !== event.from), event.ago);
    }
  }

  // ---- what happened to the applications: a banner to the applicant, and a welcome in the team chat
  for (const [index, [applicant, teamKey, status]] of applications.entries()) {
    if (status === "pending") continue;
    const team = teams.find((t) => t.key === teamKey);
    const ago = applicationReviewedAgo(index);
    const approver = team.owner;
    const tokens = `${ctx.teamId[teamKey]}:${teamName(teamKey)} | ${ctx.userId[approver]}:${fullName(approver)} | ${ctx.userId[applicant]}:${fullName(applicant)} | false`;
    if (status === "approved") {
      const welcome = `🎉 ${ctx.userId[applicant]}:${fullName(applicant)} has applied successfully to your team and has been added as a team member by ${ctx.userId[approver]}:${fullName(approver)}. Say hello to them!`;
      const welcomeId = await insertMessage(ctx, { from: approver, team: teamKey, content: welcome, ago });
      await markRead(ctx, welcomeId, membersOf(team).filter((k) => k !== approver), ago);
    }
    const marker = status === "approved" ? "✅ APPLICATION_APPROVED" : "🚫 APPLICATION_DECLINED";
    ctx.bannerId[`application:${applicant}:${teamKey}`] = await insertMessage(ctx, {
      from: approver, to: applicant, content: `${marker}: ${tokens}`, ago, readAgo: ago - FIVE_MINUTES,
    });
  }

  // ---- the conversation
  for (const m of messages) {
    const content = m.deleted ? null : withMentions(ctx, m.text);
    const ago = m.ago * MINUTE;
    const id = await insertMessage(ctx, {
      from: m.from, to: m.to, team: m.team, content, ago,
      readAgo: m.read ? Math.max(ago - FIVE_MINUTES, MINUTE) : null,
      editedAgo: m.edited ? Math.max(ago - 10 * MINUTE, MINUTE) : null,
      deletedAgo: m.deleted ? Math.max(ago - 20 * MINUTE, MINUTE) : null,
      replyTo: m.replyTo ? ctx.messageId[m.replyTo] : null,
    });
    if (m.key) ctx.messageId[m.key] = id;
    if (m.team) await markRead(ctx, id, m.readBy || [], ago);
    for (const [, key] of (m.text || "").matchAll(/\{@(\w+)\}/g)) {
      ctx.mentions.push({ messageId: id, from: m.from, to: key, team: m.team || null, content, ago });
    }
  }
}

module.exports = { seedChat };
