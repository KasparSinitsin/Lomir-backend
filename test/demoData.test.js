const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEMO_PASSWORD, CITIES, users, teams, applications, invitations, blocks, awards,
} = require("../scripts/demo/data/demoData");
const { messages } = require("../scripts/demo/data/demoChat");
const { isAcceptablePassword } = require("../src/utils/passwordRules");
const taxonomy = require("../scripts/demo/reference/taxonomy.json");
const { badges } = require("../scripts/demo/reference/badges.json");

// Everything in the demo world is invented. These tests keep it that way and keep the references straight.

const userKeys = new Set(users.map((u) => u.key));
const teamKeys = new Set(teams.map((t) => t.key));
const tagNames = new Map();
for (const t of taxonomy.tags) tagNames.set(t.name, (tagNames.get(t.name) || 0) + 1);
const badgeNames = new Set(badges.map((b) => b.name));
const teamOf = (key) => teams.find((t) => t.key === key);
const peopleOf = (team) => [team.owner, ...team.admins, ...team.members];
const NO_CONTACT_DATA = /@|https?:|www\.|\d{4}/;
// {@key} is the placeholder for a mention, not an address.
const withoutMentions = (text) => text.replace(/\{@\w+\}/g, "");

test("the demo password follows the password rule, and is a password, not a hash", () => {
  assert.equal(isAcceptablePassword(DEMO_PASSWORD), true);
  assert.doesNotMatch(DEMO_PASSWORD, /^\$2[aby]\$/);
});

test("thirteen people with unique keys, in known cities, with no contact data in their texts", () => {
  assert.equal(users.length, 13);
  assert.equal(userKeys.size, 13);
  for (const u of users) {
    assert.match(u.key, /^[a-z]+$/, "the key becomes part of the username and the example.com address");
    assert.ok(CITIES[u.city], `${u.key}: unknown city ${u.city}`);
    assert.ok(["en", "de"].includes(u.lang));
    assert.doesNotMatch(`${u.first} ${u.last} ${u.bio}`, NO_CONTACT_DATA, `${u.key}: contact data in a text`);
  }
});

test("every city has everything the app stores for a place", () => {
  for (const [name, c] of Object.entries(CITIES)) {
    for (const field of ["postal", "state", "district", "lat", "lon"]) assert.ok(c[field], `${name}: ${field}`);
  }
});

test("the special cases are there once each: a private profile, hidden badges, an unverified account", () => {
  assert.equal(users.filter((u) => u.private).length, 1);
  assert.equal(users.filter((u) => u.hideBadges).length, 1);
  assert.equal(users.filter((u) => u.unverified).length, 1);
  assert.equal(blocks.length, 1);
});

test("every tag and badge named in the demo data exists exactly once", () => {
  const needTag = (name, where) => assert.equal(tagNames.get(name), 1, `${where}: tag "${name}" missing or not unique`);
  const needBadge = (name, where) => assert.ok(badgeNames.has(name), `${where}: no badge "${name}"`);
  for (const u of users) for (const [name, interest, experience] of u.tags) {
    needTag(name, u.key);
    assert.ok(interest >= 1 && interest <= 3 && experience >= 1 && experience <= 3, `${u.key}: levels`);
  }
  for (const t of teams) {
    t.tags.forEach((n) => needTag(n, t.key));
    for (const role of t.roles) {
      role.tags.forEach((n) => needTag(n, `${t.key} role`));
      role.badges.forEach((n) => needBadge(n, `${t.key} role`));
    }
  }
  for (const a of awards) {
    needBadge(a[2], "award");
    if (a[6]) needTag(a[6], "award");
  }
});

test("teams: real owners and members, nobody twice, the city is known", () => {
  assert.equal(teams.length, 6);
  assert.equal(teamKeys.size, 6);
  for (const t of teams) {
    assert.ok(CITIES[t.city], t.key);
    const everyone = peopleOf(t);
    for (const key of [...everyone, ...t.left]) assert.ok(userKeys.has(key), `${t.key}: unknown user ${key}`);
    assert.equal(new Set(everyone).size, everyone.length, `${t.key}: someone is listed twice`);
    assert.ok(everyone.length <= t.max, `${t.key}: more members than places`);
    for (const key of t.left) assert.ok(!everyone.includes(key), `${t.key}: ${key} left and is still a member`);
    assert.doesNotMatch(`${t.name} ${t.description}`, NO_CONTACT_DATA, `${t.key}: contact data in a text`);
  }
});

test("the teams cover the states: private, archived, remote, and someone who left", () => {
  assert.equal(teams.filter((t) => t.isPublic === false).length, 1);
  assert.equal(teams.filter((t) => t.archived).length, 1);
  assert.ok(teams.some((t) => t.remote));
  assert.ok(teams.some((t) => t.left.length > 0));
});

test("roles: open, filled and closed all occur, and a filled role names a member", () => {
  const roles = teams.flatMap((t) => t.roles.map((r) => ({ team: t, role: r })));
  for (const status of ["open", "filled", "closed"]) {
    assert.ok(roles.some(({ role }) => role.status === status), `no ${status} role`);
  }
  for (const { team, role } of roles) {
    assert.ok(["open", "filled", "closed"].includes(role.status));
    assert.equal(role.status === "filled", Boolean(role.filledBy), `${team.key}: only a filled role has a filler`);
    if (role.filledBy) assert.ok(peopleOf(team).includes(role.filledBy), `${team.key}: the filler is not in the team`);
  }
});

test("applications and invitations: every status occurs, and the answers fit the teams", () => {
  for (const status of ["pending", "approved", "rejected"]) {
    assert.ok(applications.some((a) => a[2] === status), `no ${status} application`);
  }
  for (const status of ["pending", "accepted", "declined", "canceled"]) {
    assert.ok(invitations.some((i) => i[3] === status), `no ${status} invitation`);
  }
  for (const [who, team, status, message, forOpenRole] of applications) {
    assert.ok(userKeys.has(who) && teamKeys.has(team), "application");
    assert.ok(["pending", "approved", "rejected", "draft"].includes(status));
    assert.ok(message.length > 10);
    if (status === "approved") assert.ok(peopleOf(teamOf(team)).includes(who), "an accepted applicant is a member");
    if (status !== "approved") assert.ok(!peopleOf(teamOf(team)).includes(who), "the others are not");
    if (forOpenRole) assert.ok(teamOf(team).roles.some((r) => r.status === "open"), "the team has no open role");
  }
  for (const [from, to, team, status] of invitations) {
    assert.ok(userKeys.has(from) && userKeys.has(to) && teamKeys.has(team), "invitation");
    assert.notEqual(from, to);
    assert.ok(peopleOf(teamOf(team)).includes(from), "the inviter belongs to the team");
    if (status === "accepted") assert.ok(peopleOf(teamOf(team)).includes(to), "an accepted invitation made a member");
  }
});

test("awards: all 30 badges are given, to real people, with a reason", () => {
  assert.deepEqual([...badgeNames].filter((n) => !awards.some((a) => a[2] === n)), [], "badges never awarded");
  for (const [to, by, , credits, context, team, , reason, days] of awards) {
    assert.ok(userKeys.has(to) && userKeys.has(by), "award");
    assert.notEqual(to, by, "nobody awards themselves");
    assert.ok([1, 2, 3].includes(credits));
    assert.ok(["personal", "team", "project"].includes(context));
    assert.equal(context === "team", Boolean(team), "a team award names its team, others do not");
    if (team) assert.ok(teamKeys.has(team));
    assert.ok(reason.length > 10 && days >= 0);
  }
  assert.equal(awards.filter((a) => a[9] === true).length, 1, "one award is not shown yet, for the pending state");
});

test("chat: who writes where, replies come after what they answer, mentions reach members", () => {
  const seen = new Set();
  const [[blocker, blocked]] = blocks;
  for (const m of messages) {
    assert.ok(userKeys.has(m.from));
    assert.equal(Boolean(m.to) !== Boolean(m.team), true, "exactly one of receiver and team");
    assert.ok(m.ago > 0);
    if (m.to) {
      assert.ok(userKeys.has(m.to) && m.to !== m.from);
      assert.notDeepEqual([m.from, m.to].sort(), [blocker, blocked].sort(), "a blocked pair does not write to each other");
    }
    if (m.team) {
      assert.ok(peopleOf(teamOf(m.team)).includes(m.from), `${m.key}: the sender is not in the team`);
      for (const reader of m.readBy || []) assert.ok(peopleOf(teamOf(m.team)).includes(reader), `${m.key}: reader`);
    }
    if (m.deleted) assert.equal(m.text, undefined, "a deleted message has no text left");
    else {
      assert.ok(m.text.length > 5);
      assert.doesNotMatch(withoutMentions(m.text), NO_CONTACT_DATA);
      for (const [, key] of m.text.matchAll(/\{@(\w+)\}/g)) {
        assert.ok(m.team && peopleOf(teamOf(m.team)).includes(key), `${m.key}: a mention of someone outside the team`);
      }
    }
    if (m.replyTo) assert.ok(seen.has(m.replyTo), `${m.key}: answers a message that comes later`);
    if (m.key) seen.add(m.key);
  }
  assert.ok(messages.some((m) => m.replyTo) && messages.some((m) => m.edited) && messages.some((m) => m.deleted));
});
