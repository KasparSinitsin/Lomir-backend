const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * `deleteUser` scrubs display names out of stored system messages by matching
 * their emoji prefix (`NAME_BEARING_MESSAGE_PREFIXES` in
 * `userDeletionController`). That list is maintained by hand and had already
 * rotted once: it held eight prefixes while role events were being written with
 * four others, so a deleted user's name stayed in the team chat.
 *
 * This test derives the expectation from the WRITER's own table
 * (`ROLE_EVENT_MESSAGE_TYPES` in `vacantRoleController`) instead of repeating
 * the list, so adding a role event without extending the scrub fails here.
 *
 * ⚠️ The files are read as text rather than required. Requiring either
 * controller pulls in the database module, and `focusAreaProvenance.test.js`
 * is the recorded example of what that costs — its first run put a
 * `REFRESH MATERIALIZED VIEW` on the production database. A regex over the
 * source cannot do that.
 *
 * 🔴 Deliberately NOT asserted: the `🚫 …` and `🔄 ROLE_CHANGED` formats. Their
 * prefixes are absent from the scrub list on purpose — they are stored as DMs
 * and name someone other than the row's `sender_id`, so the query's other two
 * conditions exclude them whatever the prefix list says. Adding them here would
 * demand a "fix" that changes nothing. See
 * `lomir-docs-internal/HANDOVER-Privacy-Security-Hardening.md`.
 */

const readSource = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const roleEventEmoji = () => {
  const source = readSource("src/controllers/vacantRoleController.js");
  const table = source.match(
    /ROLE_EVENT_MESSAGE_TYPES\s*=\s*\{([\s\S]*?)\n\};/,
  );
  assert.ok(table, "ROLE_EVENT_MESSAGE_TYPES not found — did it move or get renamed?");

  const entries = [
    ...table[1].matchAll(/marker:\s*"(\w+)",\s*emoji:\s*"([^"]+)"/g),
  ].map(([, marker, emoji]) => ({ marker, emoji }));

  assert.ok(
    entries.length >= 7,
    `expected at least 7 role event types, found ${entries.length}`,
  );
  return entries;
};

const scrubPrefixes = () => {
  const source = readSource("src/controllers/userDeletionController.js");
  const list = source.match(
    /NAME_BEARING_MESSAGE_PREFIXES\s*=\s*\[([\s\S]*?)\];/,
  );
  assert.ok(list, "NAME_BEARING_MESSAGE_PREFIXES not found — did it move or get renamed?");
  return [...list[1].matchAll(/"([^"]+)"/g)].map(([, emoji]) => emoji);
};

const codePoints = (value) =>
  [...value].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(" ");

test("every role event emoji is in the deletion scrub's prefix list", () => {
  const prefixes = scrubPrefixes();

  for (const { marker, emoji } of roleEventEmoji()) {
    assert.ok(
      prefixes.includes(emoji),
      `${marker} writes messages prefixed ${emoji} (${codePoints(emoji)}), ` +
        `which is not in NAME_BEARING_MESSAGE_PREFIXES. A deleted user's name ` +
        `would stay in those rows. Add the prefix to the scrub list.`,
    );
  }
});

test("the scrub prefixes match the writer byte for byte, variation selectors included", () => {
  // ✏️ is U+270F U+FE0F and 🗑️ is U+1F5D1 U+FE0F. Written without the
  // selector, the LIKE would never match and the scrub would fail silently —
  // the worst outcome, since nothing errors.
  const prefixes = scrubPrefixes();

  for (const { marker, emoji } of roleEventEmoji()) {
    const match = prefixes.find((p) => p === emoji);
    assert.equal(
      codePoints(match),
      codePoints(emoji),
      `${marker}: scrub list has ${codePoints(match)}, writer emits ${codePoints(emoji)}`,
    );
  }
});

test("the scrub prefix list has no duplicates", () => {
  const prefixes = scrubPrefixes();
  const seen = new Set(prefixes);
  assert.equal(
    seen.size,
    prefixes.length,
    `duplicate prefixes: ${prefixes.filter((p, i) => prefixes.indexOf(p) !== i).join(", ")}`,
  );
});

test("the scrub query builds one LIKE per prefix, as bound parameters", () => {
  // The prefixes used to be inlined into the SQL string. They are bound
  // parameters now ($4 onward, after userId/fullName/username), so the list
  // and the query cannot drift apart in length.
  const source = readSource("src/controllers/userDeletionController.js");

  assert.match(
    source,
    /NAME_BEARING_MESSAGE_PREFIXES\.map\(/,
    "the WHERE clause no longer derives its LIKEs from the prefix list",
  );
  assert.match(
    source,
    /\[userId, fullName, user\.username, \.\.\.NAME_BEARING_MESSAGE_PREFIXES\]/,
    "the prefixes are no longer passed as bound parameters",
  );
});
