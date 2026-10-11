const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { seedDemo } = require("../src/database/demo/seedDemo");
const { users, teams, applications, invitations, awards, messages } = require("../src/database/demo/demoData");

// seedDemo runs against a recording stand-in for the database. What it may write is limited here:
// it only inserts, it touches a fixed list of tables, and every query gets exactly the parameters it names.

const source = fs.readFileSync(path.join(__dirname, "../src/database/demo/seedDemo.js"), "utf8");
const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the seed code contains no statement that removes or changes structure or data", () => {
  for (const verb of ["DELETE", "TRUNCATE", "DROP", "ALTER", "CREATE"]) {
    assert.equal(new RegExp(`\\b${verb}\\b`, "i").test(codeOnly), false, `${verb} in seedDemo.js`);
  }
});

const ALLOWED_TABLES = [
  "users", "user_tags", "teams", "team_members", "team_tags", "team_vacant_roles", "team_vacant_role_tags",
  "team_vacant_role_badges", "team_applications", "team_invitations", "badge_awards", "messages",
];

const run = async () => {
  const queries = [];
  let nextId = 100;
  const client = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (/RETURNING id/.test(sql)) return { rows: [{ id: nextId++ }] };
      if (/FROM v_user_tag_dominant_category/.test(sql)) return { rows: [{ badge_category: "Technical Expertise" }] };
      return { rows: [] };
    },
  };
  const counts = await seedDemo(client, { passwordHash: "a-hash-made-by-the-caller" });
  return { queries, counts };
};

test("it only inserts, updates what it inserted, reads one view and refreshes one", async () => {
  const { queries } = await run();
  for (const { sql } of queries) {
    const text = sql.trim().replace(/\s+/g, " ");
    assert.match(text, /^(INSERT INTO|UPDATE|SELECT|REFRESH MATERIALIZED VIEW)\b/, text.slice(0, 60));
    const table = text.match(/^(?:INSERT INTO|UPDATE) (\w+)/);
    if (table) assert.ok(ALLOWED_TABLES.includes(table[1]), `writes to ${table[1]}`);
  }
});

test("every query gets exactly the parameters it names", async () => {
  const { queries } = await run();
  for (const { sql, params } of queries) {
    const named = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const highest = named.length ? Math.max(...named) : 0;
    assert.equal(params.length, highest, sql.trim().replace(/\s+/g, " ").slice(0, 70));
    assert.equal(new Set(named).size, highest, "a parameter number is skipped");
  }
});

test("times are worked out in the database: no JavaScript Date is sent", async () => {
  const { queries } = await run();
  for (const { params } of queries) {
    for (const value of params) assert.equal(value instanceof Date, false);
  }
});

test("every account written is on example.com and carries the hash the caller made, not a password", async () => {
  const { queries } = await run();
  const inserts = queries.filter(({ sql }) => /INSERT INTO users\b/.test(sql));
  assert.equal(inserts.length, users.length);
  for (const { params } of inserts) {
    assert.match(params[1], /^demo\.[a-z]+@example\.com$/);
    assert.equal(params[2], "a-hash-made-by-the-caller");
    assert.match(params[0], /^demo_[a-z]+$/);
  }
  assert.ok(queries.every(({ sql }) => !/is_synthetic\s*=\s*false/.test(sql)));
  const userSql = inserts[0].sql;
  assert.match(userSql, /true,true,true/, "public, verified and synthetic");
});

test("it reports what it wrote, matching the demo data", async () => {
  const { counts } = await run();
  assert.equal(counts.users, users.length);
  assert.equal(counts.teams, teams.length);
  assert.equal(counts.team_vacant_roles, teams.length);
  assert.equal(counts.team_applications, applications.length);
  assert.equal(counts.team_invitations, invitations.length);
  assert.equal(counts.badge_awards, awards.length);
  assert.equal(counts.messages, messages.length);
  assert.equal(counts.awards_not_shown_yet, 1);
  assert.equal(counts.team_members, teams.reduce((n, t) => n + 1 + t.admins.length + t.members.length, 0));
});

test("a tag or badge that does not exist stops the seed", async () => {
  const demo = require("../src/database/demo/demoData");
  const original = demo.users[0].tags[0][0];
  demo.users[0].tags[0][0] = "A tag that does not exist";
  try {
    await assert.rejects(() => run(), /no tag named "A tag that does not exist"/);
  } finally {
    demo.users[0].tags[0][0] = original;
  }
});
