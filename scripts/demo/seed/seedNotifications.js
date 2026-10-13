const { teams, applications, invitations } = require("../data/demoData");
const {
  DAY, TS, badgeId, fullName, teamName, applicationCreatedAgo, applicationReviewedAgo,
  invitationCreatedAgo, invitationAnsweredAgo,
} = require("./seedContext");

const READ_AFTER = 3 * DAY; // notifications older than this count as read

// The notifications the app would have written for what the seed made: the same types and titles,
// so the bell, the notification page and the links behind them can be tried.
async function seedNotifications(ctx) {
  const rows = [];
  const add = (n) => rows.push(n);

  for (const award of ctx.awards) {
    add({
      user: award.to, type: "badge_awarded", actor: award.by, team: award.teamKey, ago: award.days * DAY,
      title: `New Badge: ${award.badge}`,
      message: `${fullName(award.by)} awarded you the "${award.badge}" badge (${award.credits} credit${award.credits > 1 ? "s" : ""})`,
      refType: "badge", refId: null, badge: award.badge,
    });
  }

  for (const [index, [applicant, teamKey, status]] of applications.entries()) {
    const team = teams.find((t) => t.key === teamKey);
    const key = `${applicant}:${teamKey}`;
    for (const admin of [team.owner, ...team.admins]) {
      add({
        user: admin, type: "application_received", actor: applicant, team: teamKey,
        ago: applicationCreatedAgo(index), title: `${fullName(applicant)} applied to join ${team.name}`,
        message: null, refType: "team_application", refId: ctx.applicationId[key],
      });
    }
    if (status === "approved") {
      add({
        user: applicant, type: "application_approved", actor: team.owner, team: teamKey,
        ago: applicationReviewedAgo(index), title: `Your application to ${team.name} was approved!`,
        message: "Welcome to the team!", refType: "message", refId: ctx.bannerId[`application:${key}`],
      });
    }
    if (status === "rejected") {
      add({
        user: applicant, type: "application_rejected", actor: team.owner, team: teamKey,
        ago: applicationReviewedAgo(index), title: `Your application to ${team.name} was declined`,
        message: null, refType: "message", refId: ctx.bannerId[`application:${key}`],
      });
    }
  }

  for (const [index, [inviter, invitee, teamKey, status]] of invitations.entries()) {
    const key = `${invitee}:${teamKey}`;
    const name = teamName(teamKey);
    add({
      user: invitee, type: "invitation_received", actor: inviter, team: teamKey, ago: invitationCreatedAgo(index),
      title: `${fullName(inviter)} invited you to join ${name}`, message: null,
      refType: "team_invitation", refId: ctx.invitationId[key],
    });
    const answer = {
      accepted: { type: "invitation_accepted", user: inviter, actor: invitee, title: `${fullName(invitee)} accepted your invitation and joined ${name}` },
      declined: { type: "invitation_declined", user: inviter, actor: invitee, title: `${fullName(invitee)} declined your invitation to ${name}` },
      canceled: { type: "invitation_cancelled", user: invitee, actor: inviter, title: `${fullName(inviter)} cancelled your invitation to ${name}` },
    }[status];
    if (answer) {
      add({
        ...answer, team: teamKey, ago: invitationAnsweredAgo(index), message: null,
        refType: "team_invitation", refId: ctx.invitationId[key],
      });
    }
  }

  for (const mention of ctx.mentions) {
    add({
      user: mention.to, type: "message_mention", actor: mention.from, team: mention.team, ago: mention.ago,
      title: `${fullName(mention.from)} mentioned you`,
      message: mention.content.length > 100 ? `${mention.content.slice(0, 97)}…` : mention.content,
      refType: mention.team ? "team" : "direct", refId: mention.messageId,
    });
  }

  for (const n of rows) {
    const refId = n.badge ? badgeId(n.badge) : n.refId;
    await ctx.client.query(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id, team_id, actor_id,
                                  read_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
               CASE WHEN $9::double precision > $10 THEN ${TS(9)} ELSE NULL END, ${TS(9)})`,
      [
        ctx.userId[n.user], n.type, n.title, n.message, n.refType, refId,
        n.team ? ctx.teamId[n.team] : null, ctx.userId[n.actor], n.ago, READ_AFTER,
      ],
    );
    ctx.bump("notifications");
  }
}

module.exports = { seedNotifications };
