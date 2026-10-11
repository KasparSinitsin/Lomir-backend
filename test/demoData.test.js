const test = require("node:test");
const assert = require("node:assert/strict");

const { DEMO_PASSWORD, CITIES, users, teams, applications, invitations, awards, messages } = require("../src/database/demo/demoData");
const { isAcceptablePassword } = require("../src/utils/passwordRules");
const taxonomy = require("../src/database/reference/taxonomy.json");
const { badges } = require("../src/database/reference/badges.json");

// Everything in the demo world is invented. These tests keep it that way and keep the references straight.

const userKeys = new Set(users.map((u) => u.key));
const teamKeys = new Set(teams.map((t) => t.key));
const tagNames = new Map();
for (const t of taxonomy.tags) tagNames.set(t.name, (tagNames.get(t.name) || 0) + 1);
const badgeNames = new Set(badges.map((b) => b.name));

test("the demo password follows the password rule, and is a password, not a hash", () => {
  assert.equal(isAcceptablePassword(DEMO_PASSWORD), true);
  assert.doesNotMatch(DEMO_PASSWORD, /^\$2[aby]\$/);
});

test("twelve people with unique keys, in known cities, with no contact data in their texts", () => {
  assert.equal(users.length, 12);
  assert.equal(userKeys.size, 12);
  for (const u of users) {
    assert.match(u.key, /^[a-z]+$/, "the key becomes part of the username and the example.com address");
    assert.ok(CITIES[u.city], `${u.key}: unknown city ${u.city}`);
    assert.ok(["en", "de"].includes(u.lang));
    assert.doesNotMatch(`${u.first} ${u.last} ${u.bio}`, /@|https?:|www\.|\d{4}/, `${u.key}: contact data in a text`);
  }
});

test("every address that will be written is on example.com, which is reserved for examples", () => {
  for (const u of users) {
    assert.match(`demo.${u.key}@example.com`, /^demo\.[a-z]+@example\.com$/);
  }
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
    t.role.tags.forEach((n) => needTag(n, `${t.key} role`));
    t.role.badges.forEach((n) => needBadge(n, `${t.key} role`));
  }
  for (const a of awards) {
    needBadge(a[2], "award");
    if (a[6]) needTag(a[6], "award");
  }
});

test("teams: real owners and members, nobody twice, the city is known", () => {
  assert.equal(teams.length, 4);
  for (const t of teams) {
    assert.ok(CITIES[t.city], t.key);
    const everyone = [t.owner, ...t.admins, ...t.members];
    for (const key of everyone) assert.ok(userKeys.has(key), `${t.key}: unknown user ${key}`);
    assert.equal(new Set(everyone).size, everyone.length, `${t.key}: someone is listed twice`);
    assert.ok(everyone.length <= t.max, `${t.key}: more members than places`);
  }
});

test("applications, invitations and awards point at real people and teams", () => {
  for (const [who, team, status] of applications) {
    assert.ok(userKeys.has(who) && teamKeys.has(team), "application");
    assert.ok(["pending", "approved", "rejected", "draft"].includes(status));
  }
  for (const [from, to, team, status] of invitations) {
    assert.ok(userKeys.has(from) && userKeys.has(to) && teamKeys.has(team), "invitation");
    assert.notEqual(from, to);
    assert.ok(["pending", "accepted", "declined", "canceled"].includes(status));
  }
  for (const [to, by, , credits, context, team, , reason, days] of awards) {
    assert.ok(userKeys.has(to) && userKeys.has(by), "award");
    assert.notEqual(to, by, "nobody awards themselves");
    assert.ok([1, 2, 3].includes(credits));
    assert.ok(["personal", "team", "project"].includes(context));
    assert.equal(context === "team", Boolean(team), "a team award names its team, others do not");
    if (team) assert.ok(teamKeys.has(team));
    assert.ok(reason.length > 10 && days >= 0);
  }
});

test("one award is not shown yet, so the pending state can be tried", () => {
  assert.equal(awards.filter((a) => a[9] === true).length, 1);
});

test("messages: a team message has a team and no receiver, a direct one the opposite", () => {
  for (const [from, to, team, text, minutes] of messages) {
    assert.ok(userKeys.has(from));
    assert.equal(Boolean(to) !== Boolean(team), true, "exactly one of receiver and team");
    if (to) assert.ok(userKeys.has(to) && to !== from);
    if (team) assert.ok(teamKeys.has(team));
    assert.ok(text.length > 5 && minutes > 0);
    assert.doesNotMatch(text, /@|https?:/);
  }
});
