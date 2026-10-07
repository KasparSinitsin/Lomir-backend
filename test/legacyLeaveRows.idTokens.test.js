// The legacy leave-row migration rewrites STORED MESSAGE TEXT, and it re-runs on
// EVERY `npm run migrate`, so its rule is pinned here rather than trusted to review.
//
// 🔴 Why each assertion exists, in the order it would hurt:
//
//   1. The target must be the format the writer emits. A glyph or marker typed
//      slightly differently matches nothing, and the migration would report
//      "0 rows" and look healthy.
//   2. There must be a DATE CUT. The migration re-runs, so without
//      `sent_at < 2026-01-15` a user who later types `🚪 Zoe has left the team.`
//      would be rewritten into a system message under their own id. The writer
//      stopped emitting the legacy shape on 2026-01-14, so no genuine legacy row
//      can be newer.
//   3. It must be restricted to team messages with a sender: the id comes from
//      the sender, and a NULL sender has nobody to take it from.
//   4. A name that matches a DIFFERENT living user must be left alone.
//   5. `\s` in a JS template literal is just `s`. The SQL must carry `\\s`, or
//      the patterns would match a literal letter and touch nothing.
//   6. It must own a transaction, verify itself and refuse an impossible count,
//      because `index.js` catches a module's error WITHOUT rethrowing.
//   7. It must name its DRY RUN (`STATUS.md` habit 11).
//
// ⚠️ Read as TEXT, never required: the module imports the database config, and
// requiring it would open a pool. Behaviour against real rows was checked on a
// throwaway postgres with `deletion-audit/fixtures/33-fixture.sql`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { NAME_BEARING_MESSAGE_FORMATS } = require("../src/config/nameBearingMessageFormats");

const source = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/add_person_id_to_legacy_leave_rows.js"),
  "utf8",
);
const index = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/index.js"),
  "utf8",
);

test("the target is exactly the MEMBER_LEFT prefix the scrub config knows", () => {
  const memberLeft = NAME_BEARING_MESSAGE_FORMATS.find((f) => f.marker === "MEMBER_LEFT");
  assert.ok(memberLeft, "MEMBER_LEFT must be a known format");
  const prefix = `${memberLeft.emoji} ${memberLeft.marker}:`;
  assert.ok(
    source.includes(`'${prefix}' || m.sender_id::text || ':'`),
    `the rewrite must start with ${JSON.stringify(prefix)} — compare code points, not glyphs`,
  );
});

test("the id is the sender's and the stored name is kept after it", () => {
  assert.ok(source.includes("m.sender_id::text || ':' || ${NAME}"));
  assert.ok(source.includes("substring(m.content from '^🚪 (.+) has left the team\\\\.$')"));
});

test("it is restricted to team messages with a sender, before the cutoff", () => {
  assert.ok(source.includes("m.team_id IS NOT NULL"));
  assert.ok(source.includes("m.sender_id IS NOT NULL"));
  assert.ok(source.includes("m.sent_at < '2026-01-15'"));
  assert.ok(source.includes("m.content ~ '^🚪 .+ has left the team\\\\.$'"));
});

test("a name that matches a different living user is left alone", () => {
  assert.ok(source.includes("= (SELECT un.name FROM un WHERE un.id = m.sender_id)"));
  assert.ok(source.includes("OR (SELECT count(*) FROM un WHERE un.name = ${NORMALISED}) = 0"));
});

test("regexes are written with doubled backslashes", () => {
  const sql = source.slice(source.indexOf("const NAME"), source.indexOf("const UPDATE_SQL"));
  assert.ok(!/[^\\]\\s/.test(sql), "a single-backslash \\s would be read as a literal s");
  assert.ok(sql.includes("\\\\s+"));
});

test("it owns a transaction, verifies itself and refuses an impossible count", () => {
  assert.ok(source.includes('"BEGIN"'));
  assert.ok(source.includes('"COMMIT"'));
  assert.ok(source.includes('"ROLLBACK"'));
  assert.ok(source.includes("REMAINING_SQL"));
  assert.ok(source.includes("result.rowCount > MAX_ROWS"));
  assert.ok(source.includes("const MAX_ROWS = 16"));
  assert.ok(source.includes("const EXPECTED_ROWS = 16"));
});

test("it names its dry run", () => {
  assert.ok(source.includes("deletion-audit/33"));
});

test("it is registered, and after the marker migration", () => {
  const a = index.indexOf("await addPersonIdsToLegacyMarkerDms();");
  const b = index.indexOf("await addPersonIdToLegacyLeaveRows();");
  assert.ok(a !== -1 && b !== -1, "both migrations must be called");
  assert.ok(b > a);
});
