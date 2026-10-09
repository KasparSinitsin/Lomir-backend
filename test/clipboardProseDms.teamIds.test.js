// The 📋 prose TEAM id migration rewrites STORED MESSAGE TEXT on 19 production
// rows (item 35), so its rule is pinned here rather than trusted to review.
//
// 🔴 Why each assertion exists, in the order it would hurt:
//
//   1. Exactly the four formats `61`–`64` measured: F4, RA, IR, YA. The first
//      guess "ID" (invitee declined your invitation to join) has no rows.
//   2. The population: DMs, before the date cut, 📋 only, quoted team without
//      an id. That last guard is what makes a second run a no-op.
//   3. Path N needs more than the name: the team existed when the DM was
//      written AND the DM's people are linked to it. `teams.name` has no
//      UNIQUE rule, so a name alone could point to a later team.
//   4. The source-conflict veto must be wrapped in coalesce, or every row
//      without a strict source would silently drop (fixture negative control).
//   5. No lazy `.+?` before a quote: in Postgres the FIRST quantifier sets the
//      greediness of the whole RE, so it ran on to a later `for "…":` inside a
//      personal message (rounds 62, 63; fixture negative control).
//   6. The rewrite only inserts `<id>:` after the first quote.
//   7. `\s` in a JS template literal is just `s`; the SQL must carry `\\s`.
//   8. It owns a transaction, verifies itself and refuses an impossible count,
//      because `index.js` catches a module's error WITHOUT rethrowing.
//   9. It names its dry run and runs last, after the marker team-id migration.
//
// ⚠️ Read as TEXT, never required: requiring the module would open a pool.
// Behaviour against real rows: `deletion-audit/fixtures/63-verify.cjs`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/add_team_ids_to_clipboard_prose_dms.js"),
  "utf8",
);
const index = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/index.js"),
  "utf8",
);
const sql = source.slice(source.indexOf("const FORMAT_SQL"), source.indexOf("const UPDATE_SQL"));

test("exactly the four measured formats, and not the template without rows", () => {
  const formats = [...sql.matchAll(/THEN '([A-Z0-9]{2})'/g)].map((m) => m[1]);
  assert.deepEqual(formats.slice(0, 4), ["F4", "RA", "IR", "YA"]);
  assert.doesNotMatch(source, /declined your invitation to join/);
  assert.match(sql, /Your application to \\"\[\^"\]\+\\" was declined by|Your application to "\[\^"\]\+" was declined by/);
});

test("the population is id-less 📋 DMs before the cut", () => {
  assert.match(sql, /WHERE m\.team_id IS NULL/);
  assert.match(sql, /m\.sent_at < '2026-01-16'/);
  assert.match(sql, /m\.content LIKE '📋%'/);
  assert.match(sql, /NOT \(b\.raw_team ~ '\^\\\\d\+\\\\s\*:'\)/);
});

test("path N needs the team to predate the DM and the DM's people to be linked", () => {
  assert.match(sql, /t\.id = c\.name_team_id AND t\.created_at <= c\.sent_at/);
  assert.match(sql, /ta\.applicant_id = c\.receiver_id AND ta\.status = 'rejected'/);
  assert.match(sql, /ti\.invitee_id = c\.sender_id\s+AND ti\.inviter_id = c\.receiver_id AND ti\.status = 'declined'/);
  assert.match(sql, /c\.fmt IN \('F4', 'RA', 'YA'\)/);
});

test("the source-conflict veto survives a missing source", () => {
  assert.match(sql, /AND NOT coalesce\(cardinality\(c\.src_teams\) = 1\s+AND c\.src_teams\[1\] <> c\.name_team_id, false\)/);
});

test("no lazy group before a quote", () => {
  assert.doesNotMatch(sql, /\.\+\?/);
  assert.match(sql, /"\(\[\^"\]\+\)"/);
});

test("the rewrite only inserts <id>: after the first quote", () => {
  assert.match(sql, /strpos\(m\.content, '"'\) AS q/);
  assert.match(sql, /left\(d\.content, d\.q\) \|\| d\.team_id::text \|\| ':' \|\| substr\(d\.content, d\.q \+ 1\)/);
  assert.match(source, /AND m\.content = plan\.content/);
});

test("regex escapes survive the template literal", () => {
  assert.match(sql, /\\\\s\+/);
  assert.match(sql, /\\\\n\\\\n/);
  assert.doesNotMatch(sql.replace(/\\\\s/g, ""), /[^\\]\\s/);
});

test("it owns a transaction, verifies itself and refuses an impossible count", () => {
  assert.match(source, /BEGIN/);
  assert.match(source, /ROLLBACK/);
  assert.match(source, /const EXPECTED_ROWS = 19;/);
  assert.match(source, /const MAX_ROWS = 21;/);
  assert.match(source, /remaining !== 0/);
});

test("it names its dry run and runs last", () => {
  assert.match(source, /deletion-audit\/63/);
  const marker = index.indexOf("await addTeamIdsToLegacyMarkerDms();");
  const prose = index.indexOf("await addTeamIdsToClipboardProseDms();");
  assert.ok(marker > 0 && prose > marker, "must run after the marker team-id migration");
  assert.ok(index.indexOf("await ", prose + 10) === -1 || index.indexOf("await ", prose + 10) > index.indexOf("All migrations completed"),
    "must be the last migration");
});
