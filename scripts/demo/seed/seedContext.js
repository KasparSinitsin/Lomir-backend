/**
 * What the parts of the demo seed share: the time helpers, the name lookups and the record of
 * which id belongs to which key.
 *
 * Times are worked out in the database, from "milliseconds ago", so that each column gets its own
 * type: `timestamp` columns hold UTC (that is how the app reads them), `timestamptz` columns an instant.
 * A negative number is a time in the future.
 */
const taxonomy = require("../reference/taxonomy.json");
const { badges } = require("../reference/badges.json");
const { users, teams } = require("../data/demoData");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const TS = (p) => `((NOW() AT TIME ZONE 'UTC') - ($${p}::double precision * interval '1 millisecond'))`;
const TSTZ = (p) => `(NOW() - ($${p}::double precision * interval '1 millisecond'))`;

// The same two, for a column that may stay empty: the parameter is NULL, or "ms ago".
// (PostgreSQL refuses a parameter that the statement never mentions, so a variable `NULL` will not do.)
const TSN = (p) => `(CASE WHEN $${p}::double precision IS NULL THEN NULL ELSE ${TS(p)} END)`;
const TSTZN = (p) => `(CASE WHEN $${p}::double precision IS NULL THEN NULL ELSE ${TSTZ(p)} END)`;

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

const userByKey = new Map(users.map((u) => [u.key, u]));
const teamByKey = new Map(teams.map((t) => [t.key, t]));
// The display name the app writes into messages and notifications.
const fullName = (key) => {
  const user = userByKey.get(key);
  if (!user) throw new Error(`demo data: no user "${key}"`);
  return `${user.first} ${user.last}`;
};
const teamName = (key) => {
  const team = teamByKey.get(key);
  if (!team) throw new Error(`demo data: no team "${key}"`);
  return team.name;
};

// How long ago each team was created, in milliseconds: the first team is the oldest.
const teamCreatedAgo = (teamKey) => (30 - teams.findIndex((t) => t.key === teamKey) * 3) * DAY;

// When applications and invitations were made and answered (ms ago), by their place in the list.
const applicationCreatedAgo = (index) => (6 - index) * DAY;
const applicationReviewedAgo = (index) => (5 - index) * DAY;
const invitationCreatedAgo = (index) => (9 - index) * DAY;
const invitationAnsweredAgo = (index) => (8 - index) * DAY;

const createContext = (client) => {
  const counts = {};
  return {
    client,
    userId: {}, teamId: {}, roleId: {}, // key -> id; roleId["garden:0"] = id of the first role of that team
    applicationId: {}, invitationId: {}, // "applicant:team" and "invitee:team" -> id
    awards: [], // the inserted awards, for the notifications
    messageId: {}, // free-text chat messages by key, for replies and mentions
    bannerId: {}, // system messages by name, for the notifications that point at them
    mentions: [], // { messageId, from, to, team, content, ago }, for the mention notifications
    counts,
    bump: (name, n = 1) => { counts[name] = (counts[name] || 0) + n; },
  };
};

module.exports = {
  MINUTE, HOUR, DAY, TS, TSTZ, TSN, TSTZN, tagId, badgeId, fullName, teamName, teamCreatedAgo, createContext,
  applicationCreatedAgo, applicationReviewedAgo, invitationCreatedAgo, invitationAnsweredAgo,
};
