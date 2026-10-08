// The legacy-marker TEAM id migration rewrites STORED MESSAGE TEXT on 116
// production rows, so its rule is pinned here rather than trusted to review.
//
// 🔴 Why each assertion exists, in the order it would hurt:
//
//   1. The eight markers must be exactly the formats of `deletion-audit/55`.
//   2. The population must be DMs, before the date cut, with NO id in slot 1.
//      That guard is what makes a second run a no-op.
//   3. Path N needs more than the name: the team existed when the DM was
//      written AND is linked to the DM's people. `teams.name` has no UNIQUE
//      rule, so a name alone could point to a later team that reused it.
//   4. The source-conflict veto must be wrapped in coalesce: without a source
//      it is NULL, and NOT (NULL AND …) would silently drop the four formats
//      that have no second source (caught by the fixture's negative control).
//   5. The rewrite must only insert `<team id>:` after the head.
//   6. `\s` and `\d` in a JS template literal are just `s` and `d`. The SQL must
//      carry `\\s`, or every pattern would match a literal letter.
//   7. It must own a transaction, verify itself and refuse an impossible count,
//      because `index.js` catches a module's error WITHOUT rethrowing.
//   8. It must name its DRY RUN and run after the earlier marker migrations.
//
// ⚠️ Read as TEXT, never required: the module imports the database config, and
// requiring it would open a pool. Behaviour against real rows was checked on a
// throwaway postgres with `deletion-audit/fixtures/57-verify.cjs`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/add_team_ids_to_legacy_marker_dms.js"),
  "utf8",
);
const index = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/index.js"),
  "utf8",
);

const markersBlock = source.slice(source.indexOf("const MARKERS = ["), source.indexOf("];") + 2);
const markers = [...markersBlock.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);

test("there are exactly the eight formats of deletion-audit/55", () => {
  assert.deepEqual(markers.sort(), [
    "APPLICATION_APPROVED",
    "APPLICATION_CANCELLED",
    "APPLICATION_DECLINED",
    "INVITATION_CANCELLED",
    "INVITATION_DECLINED",
    "MEMBER_REMOVED",
    "OWNERSHIP_TRANSFERRED",
    "ROLE_CHANGED",
  ]);
});

test("the population is DMs before the cut whose slot 1 carries no id", () => {
  assert.match(source, /WHERE m\.team_id IS NULL/);
  assert.match(source, /AND m\.sent_at < '2026-01-16'/);
  assert.match(source, /AND NOT \(regexp_replace\(m\.content, '\^\[\^:\]\*:\\\\s\*', ''\) ~ '\^\\\\d\+\\\\s\*:'\)/);
});

test("path N needs the team to have existed then AND a link to the people", () => {
  assert.match(source, /WHEN c\.name_teams = 1\s+AND EXISTS \(SELECT 1 FROM teams t\s+WHERE t\.id = c\.name_team_id AND t\.created_at <= c\.sent_at\)/);
  for (const table of ["team_members tm", "team_applications ta", "team_invitations ti"]) {
    assert.ok(source.includes(`FROM ${table}\n                            WHERE ${table.split(" ")[1]}.team_id = c.name_team_id`),
      `people link through ${table}`);
  }
});

test("the source-conflict veto is NULL-safe", () => {
  assert.match(source, /AND NOT coalesce\(cardinality\(c\.src_teams\) = 1\s+AND c\.src_teams\[1\] <> c\.name_team_id, false\)/);
  assert.doesNotMatch(source, /AND NOT \(cardinality\(c\.src_teams\)/);
});

test("path S needs no name match and exactly one source team that existed then", () => {
  assert.match(source, /WHEN c\.name_teams = 0\s+AND cardinality\(c\.src_teams\) = 1\s+AND EXISTS \(SELECT 1 FROM teams t\s+WHERE t\.id = c\.src_teams\[1\] AND t\.created_at <= c\.sent_at\)/);
});

test("the rewrite only inserts '<team id>:' after the head", () => {
  assert.match(source, /d\.head \|\| d\.team_id::text \|\| ':' \|\| substring\(d\.content FROM length\(d\.head\) \+ 1\) AS new_content/);
  assert.match(source, /AND m\.content = plan\.content/);
});

test("regex escapes survive the template literal", () => {
  const sqlPart = source.slice(source.indexOf("const NORM"), source.indexOf("const UPDATE_SQL"));
  // A lone backslash before s, S or d (not part of `\\s`) would reach SQL as a letter.
  assert.doesNotMatch(sqlPart, /(?<!\\)\\[sSd]/);
  assert.ok(sqlPart.includes("\\\\s+"));
  assert.ok(sqlPart.includes("^\\\\d+\\\\s*:"));
});

test("it owns a transaction, verifies itself and refuses an impossible count", () => {
  assert.match(source, /await client\.query\("BEGIN"\)/);
  assert.match(source, /await client\.query\("ROLLBACK"\)/);
  assert.match(source, /if \(result\.rowCount > MAX_ROWS\)/);
  assert.match(source, /if \(rows\[0\]\.remaining !== 0\)/);
  assert.match(source, /const EXPECTED_ROWS = 116;/);
  assert.match(source, /const MAX_ROWS = 204;/);
});

test("it names its dry run and runs last in index.js", () => {
  assert.match(source, /deletion-audit\/57/);
  const scrubAt = index.indexOf("await scrubDeletedPeopleInApplicationEvents();");
  const teamIdsAt = index.indexOf("await addTeamIdsToLegacyMarkerDms();");
  const personIdsAt = index.indexOf("await addPersonIdsToLegacyMarkerDms();");
  assert.ok(personIdsAt > -1 && scrubAt > -1 && teamIdsAt > -1);
  assert.ok(teamIdsAt > scrubAt && teamIdsAt > personIdsAt);
  assert.match(index, /require\(\s*"\.\/add_team_ids_to_legacy_marker_dms"\s*\)/);
});
