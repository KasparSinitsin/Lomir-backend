const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  NAME_BEARING_MESSAGE_FORMATS,
  NAME_BEARING_MESSAGE_PREFIXES,
  FORMATS_NAMING_SOMEONE_OTHER_THAN_SENDER,
  FORMATS_WITH_NULL_SENDER,
  FORMATS_WRITTEN_BY_THE_FRONTEND,
  FORMATS_CLEARED_OF_PERSON_NAMES,
  OBSERVED_ROWS_2026_10_01,
} = require("../src/config/nameBearingMessageFormats");

/**
 * `deleteUser` scrubs display names out of stored team messages by matching
 * their emoji prefix. That list used to be maintained by hand in the controller
 * and had rotted once: it held eight prefixes while role events were being
 * written with four others, so a deleted user's name stayed in the team chat.
 * It is now DERIVED from `config/nameBearingMessageFormats.js`, which traces
 * every stored format to its write site.
 *
 * ⚠️ `vacantRoleController` is read as TEXT rather than required. Requiring it
 * pulls in the database module, and `focusAreaProvenance.test.js` is the
 * recorded example of what that costs — its first run put a
 * `REFRESH MATERIALIZED VIEW` on the production database. A regex over the
 * source cannot do that. The config module holds no imports at all, so it is
 * required directly.
 *
 * 🔴 A rationale this file carried until 2026-10-01 was WRONG, and the
 * correction is the part worth keeping. It said the `🚫 …` formats were all
 * excluded on purpose because they "are stored as DMs", so adding their prefix
 * "would demand a fix that changes nothing". Two things were wrong with that:
 *
 *   1. `🚫 MEMBER_REMOVED_PUBLIC` is NOT a DM. It is a team message, it names
 *      only the removed member, and its sender is the admin who removed them —
 *      so the name survives deletion. One blanket statement about an emoji
 *      covered two formats with opposite storage.
 *   2. For the formats that ARE DMs, the name does not survive either, but not
 *      for the reason given: the rows are deleted outright by the
 *      `team_id IS NULL` delete that runs before the scrub. The conclusion was
 *      right, the mechanism was not — and the difference matters, because a DM
 *      naming a THIRD party would escape both.
 *
 * The lesson: a rationale that names an emoji invites everyone to reason about
 * the emoji. Storage and authorship are what decide, which is why the table
 * records both per format.
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

const codePoints = (value) =>
  [...value].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(" ");

const identify = (format) => format.marker ?? `prose ${format.emoji}`;

test("every role event emoji is in the deletion scrub's prefix list", () => {
  for (const { marker, emoji } of roleEventEmoji()) {
    assert.ok(
      NAME_BEARING_MESSAGE_PREFIXES.includes(emoji),
      `${marker} writes messages prefixed ${emoji} (${codePoints(emoji)}), ` +
        `which is not in NAME_BEARING_MESSAGE_PREFIXES. A deleted user's name ` +
        `would stay in those rows. Add the format to ` +
        `config/nameBearingMessageFormats.js.`,
    );
  }
});

test("every role event is also present in the traced format table", () => {
  // The prefix check above passes as soon as SOME format shares the emoji.
  // ✅ is written by four different formats, so the emoji alone proves nothing
  // about whether a given role event was ever traced.
  const tracedMarkers = new Set(
    NAME_BEARING_MESSAGE_FORMATS.map((format) => format.marker).filter(Boolean),
  );

  for (const { marker } of roleEventEmoji()) {
    assert.ok(
      tracedMarkers.has(marker),
      `${marker} is written by vacantRoleController but has no entry in ` +
        `config/nameBearingMessageFormats.js, so nothing records how its row ` +
        `is stored or whose name it carries.`,
    );
  }
});

test("the scrub prefixes match the writer byte for byte, variation selectors included", () => {
  // ✏️ is U+270F U+FE0F and 🗑️ is U+1F5D1 U+FE0F. Written without the
  // selector, the LIKE would never match and the scrub would fail silently —
  // the worst outcome, since nothing errors.
  for (const { marker, emoji } of roleEventEmoji()) {
    const match = NAME_BEARING_MESSAGE_PREFIXES.find((p) => p === emoji);
    assert.equal(
      codePoints(match),
      codePoints(emoji),
      `${marker}: scrub list has ${codePoints(match)}, writer emits ${codePoints(emoji)}`,
    );
  }
});

test("the scrub prefix list has no duplicates", () => {
  const seen = new Set(NAME_BEARING_MESSAGE_PREFIXES);
  assert.equal(
    seen.size,
    NAME_BEARING_MESSAGE_PREFIXES.length,
    `duplicate prefixes: ${NAME_BEARING_MESSAGE_PREFIXES.filter(
      (p, i) => NAME_BEARING_MESSAGE_PREFIXES.indexOf(p) !== i,
    ).join(", ")}`,
  );
});

test("the prefix list carries team formats only, because DMs are deleted not scrubbed", () => {
  const teamEmoji = new Set(
    NAME_BEARING_MESSAGE_FORMATS.filter((f) => f.storage === "team").map(
      (f) => f.emoji,
    ),
  );

  assert.deepEqual(
    [...NAME_BEARING_MESSAGE_PREFIXES].sort(),
    [...teamEmoji].sort(),
    "the derived prefix list no longer equals the team formats' emoji",
  );

  // A DM-only emoji in the list would be harmless but misleading; a team emoji
  // missing from it is a retained name.
  for (const format of NAME_BEARING_MESSAGE_FORMATS) {
    if (format.storage !== "team") continue;
    assert.ok(
      NAME_BEARING_MESSAGE_PREFIXES.includes(format.emoji),
      `${identify(format)} is stored as a team message but its prefix is not ` +
        `in the derived list`,
    );
  }
});

test("every traced format states its storage and whose name it carries", () => {
  for (const format of NAME_BEARING_MESSAGE_FORMATS) {
    assert.ok(
      ["team", "dm"].includes(format.storage),
      `${identify(format)} has storage ${JSON.stringify(format.storage)}; ` +
        `the scrub branches on this, so it cannot be left open`,
    );
    assert.equal(
      typeof format.namedIsSender,
      "boolean",
      `${identify(format)} does not say whether the name in its content ` +
        `belongs to the row's sender_id — that is what decides whether the ` +
        `scrub can reach it`,
    );
    assert.ok(
      format.emoji.length > 0,
      `${identify(format)} has an empty prefix, which would make the scrub ` +
        `match every row`,
    );
  }
});

test("the known sender_id gap is exactly the formats that were traced", () => {
  // 🔴 A GAP, not a passing state: these team formats name someone other than
  // their sender, so the scrub's `sender_id = $1` condition cannot reach them.
  // Pinned so that a NEW format with the same flaw fails here loudly instead
  // of joining a known list.
  //
  // ⚠️ Grew from 5 to 10 on 2026-10-01, and NOT because the code changed.
  // Three of the additions came out of a database census; two came out of
  // dropping the `live` filter, because 6 legacy MEMBER_REMOVED team rows leak
  // exactly like a live format — a stored row does not care that its writer
  // was deleted. The old list was a list of today's writers pretending to be
  // a list of what is in the table.
  const expected = [
    "ROLE_FILLED",
    "ROLE_REOPENED",
    "ROLE_APPLICATION_FILLED",
    "ROLE_APPLICATION_DEFERRED_INVITE",
    "ROLE_INVITATION_ACCEPTED",
    "MEMBER_REMOVED",
    "MEMBER_REMOVED_PUBLIC",
    "OWNERSHIP_TEAM",
    "prose 🎉",
    "prose ❌",
    "prose 👋",
    // ⚠️ `prose 🔓` was here until it was CHECKED: it renders through the
    // parser's legacy role-only pattern and names no person, so it carries
    // `carriesPersonName: false` and leaves the gap. Removing an entry from a
    // gap list is only legitimate with evidence — see its comment in the config
    // for what was observed and what is still inferred.
  ].sort();

  const actual = FORMATS_NAMING_SOMEONE_OTHER_THAN_SENDER.map(identify).sort();

  assert.deepEqual(
    actual,
    expected,
    "the set of team formats naming a non-sender changed. If you ADDED one, " +
      "it leaks a name on account deletion — fix the format or the scrub. If " +
      "you FIXED the scrub, update this expectation and the audit doc.",
  );
});

test("deleteUser still writes the successor tombstone with a NULL sender", () => {
  // 🔴 The worst row in the whole audit, and deleteUser creates it: handing a
  // team to a successor writes `👑 OWNERSHIP_TEAM: Former Lomir User |
  // <successor>` with `sender_id = NULL`. The deleted user is anonymised, the
  // successor is named in full, and no `sender_id = $1` condition can ever
  // reach a NULL. Deleting the successor later leaves their name in place.
  //
  // This is asserted against the WRITER rather than the table, so that fixing
  // the writer (a real sender, or an id token in the content) makes the table
  // entry fail as stale instead of quietly outliving its reason.
  const source = readSource("src/controllers/userDeletionController.js");

  assert.match(
    source,
    /\[\s*null,\s*team\.teamId,\s*`\u{1F451} OWNERSHIP_TEAM:/u,
    "the successor tombstone changed shape. If it now has a real sender_id or " +
      "carries ids instead of bare names, drop `senderCanBeNull` from the " +
      "OWNERSHIP_TEAM entry in config/nameBearingMessageFormats.js and update " +
      "the audit doc.",
  );
  assert.match(
    source,
    /OWNERSHIP_TEAM:[^`]*\$\{successor\.name\}/u,
    "the successor tombstone no longer interpolates a real display name — if " +
      "that is deliberate, this format is no longer name-bearing",
  );
});

test("the formats unreachable by any sender condition are exactly the traced one", () => {
  // 🔴 A GAP, pinned on purpose. A NULL sender is not a narrower case of
  // "someone other than the sender" — it defeats every sender-based condition,
  // which is why a replacement has to match on the CONTENT instead.
  // ⚠️ Was ["OWNERSHIP_TEAM"] until 2026-10-01, when the census showed NULL
  // senders are not a quirk of one format: 5 of the 136 `👋` team rows carry
  // none either. The `🔓` prose rows have no sender either, but they name
  // nobody, so they are not a deletion problem — see
  // `FORMATS_CLEARED_OF_PERSON_NAMES`.
  assert.deepEqual(
    FORMATS_WITH_NULL_SENDER.map(identify).sort(),
    ["OWNERSHIP_TEAM", "prose 👋"].sort(),
    "the set of name-bearing formats written with sender_id NULL changed. A " +
      "new one means another row that no sender-based scrub can reach.",
  );

  // Every NULL-sender format is by definition also a non-sender format; if the
  // two lists ever disagree, one of the flags is wrong.
  for (const format of FORMATS_WITH_NULL_SENDER) {
    assert.ok(
      FORMATS_NAMING_SOMEONE_OTHER_THAN_SENDER.includes(format),
      `${identify(format)} is marked senderCanBeNull but also namedIsSender: ` +
        `true, which cannot both hold — a NULL sender is nobody's name`,
    );
  }
});

test("a format that records several write sites lists them all", () => {
  // `writtenBy` accepts a string or an array. OWNERSHIP_TEAM has two writers
  // and only one of them has the NULL sender, so collapsing it back to a
  // single string would hide the dangerous half.
  for (const format of NAME_BEARING_MESSAGE_FORMATS) {
    if (format.writtenBy === null) continue;
    const sites = Array.isArray(format.writtenBy)
      ? format.writtenBy
      : [format.writtenBy];
    assert.ok(
      sites.length > 0 && sites.every((s) => typeof s === "string" && s.length > 0),
      `${identify(format)} has an unusable writtenBy: ${JSON.stringify(format.writtenBy)}`,
    );
  }
});

test("every NULL-sender format says where the NULL comes from, or says it is unknown", () => {
  // ⚠️ This assertion used to demand that a write site mention the NULL, and
  // it was too strict — it assumed a NULL sender always has a findable writer.
  // On 2026-10-01 two formats turned up whose null-sender rows have NO known
  // writer: `👋` (5 of 136) and the `🔓` prose form (all 6, no writer at all).
  //
  // Weakening it to nothing would have been the wrong repair. Instead
  // `nullSenderSource` is now required, so "we do not know" has to be written
  // down rather than left as an absence that reads like an oversight.
  for (const format of NAME_BEARING_MESSAGE_FORMATS) {
    if (!format.senderCanBeNull) continue;

    assert.equal(
      typeof format.nullSenderSource,
      "string",
      `${identify(format)} is marked senderCanBeNull without a ` +
        `nullSenderSource. Name the write site, or write "unknown — <what the ` +
        `data showed>". An absent field cannot be told apart from a forgotten one.`,
    );
    assert.ok(
      format.nullSenderSource.length > 0,
      `${identify(format)} has an empty nullSenderSource`,
    );
  }
});

test("every marker seen in the database has an entry in the table", () => {
  // 🔴 THE test this audit was missing. `TEAM_DELETED` sat in the database
  // from 2026-01-06 and was absent from the table, because the table was built
  // from the frontend parser's `// Format:` comments and that format has none.
  // A census of real rows does not ask the parser, so it found it immediately.
  //
  // This binds the two together: a marker observed in `messages` must be
  // described here. Rows are the authority, not the writers.
  const tracedMarkers = new Set(
    NAME_BEARING_MESSAGE_FORMATS.map((f) => f.marker).filter(Boolean),
  );

  const observedMarkers = Object.keys(OBSERVED_ROWS_2026_10_01)
    .map((prefix) => prefix.match(/([A-Z_]{4,}):/)?.[1])
    .filter(Boolean);

  assert.ok(observedMarkers.length >= 20, `only ${observedMarkers.length} markers parsed out of the census — the census keys changed shape`);

  for (const marker of observedMarkers) {
    assert.ok(
      tracedMarkers.has(marker),
      `${marker} has rows in the database (census 2026-10-01) but no entry in ` +
        `nameBearingMessageFormats.js. Nothing records whose name it carries, ` +
        `so the scrub cannot be reasoned about for those rows.`,
    );
  }
});

test("a format with legacy rows of the other storage kind keeps its prefix listed", () => {
  // 🚫 MEMBER_REMOVED writes DMs today but has 6 team rows from a dead path.
  // Those rows are reachable ONLY through the scrub, so the prefix must be in
  // the list even though `storage` says "dm". It currently is, but only
  // because MEMBER_REMOVED_PUBLIC happens to share 🚫 — this asserts the
  // derivation, not the coincidence.
  const withLegacyTeamRows = NAME_BEARING_MESSAGE_FORMATS.filter(
    (f) => f.legacyStorage === "team",
  );

  assert.ok(
    withLegacyTeamRows.length > 0,
    "no format records legacy team rows any more — if that is a real fix, " +
      "the 6 MEMBER_REMOVED rows must have been migrated; say so in the doc",
  );

  for (const format of withLegacyTeamRows) {
    assert.ok(
      NAME_BEARING_MESSAGE_PREFIXES.includes(format.emoji),
      `${identify(format)} has legacy team rows but its prefix is not in the ` +
        `derived list, so those rows can never be scrubbed`,
    );
  }
});

test("the frontend writers are recorded, because searching this repo cannot find them", () => {
  // 🔴 `ROLE_APPLICATION_FILLED` was recorded as "legacy, no write site" while
  // 48 live rows existed, because `git log -S` over this repo finds nothing —
  // the string has never been in this repo. The writer is in the frontend,
  // which POSTs the system message through the ordinary send-message API.
  //
  // This cannot be guarded from here. The least it can do is refuse to forget.
  const frontendWritten = FORMATS_WRITTEN_BY_THE_FRONTEND.map(identify).sort();

  assert.deepEqual(
    frontendWritten,
    ["ROLE_APPLICATION_FILLED", "ROLE_INVITATION_ACCEPTED", "ROLE_REOPENED"].sort(),
    "the set of frontend-written formats changed. Check " +
      "Lomir-frontend/src/utils/roleEventMessages.js for callers — it holds " +
      "builders for further formats that are not currently sent.",
  );

  for (const format of FORMATS_WRITTEN_BY_THE_FRONTEND) {
    const sites = Array.isArray(format.writtenBy) ? format.writtenBy : [format.writtenBy];
    assert.ok(
      sites.some((s) => /FRONTEND/.test(s)),
      `${identify(format)} is marked as frontend-written but no write site ` +
        `says which file in the other repo — the next audit would grep here ` +
        `and find nothing, exactly as this one did`,
    );
  }
});

test("writtenIn, when present, names a repo the table knows about", () => {
  for (const format of NAME_BEARING_MESSAGE_FORMATS) {
    if (format.writtenIn === undefined) continue; // omitted means backend-only
    assert.ok(
      ["frontend", "both"].includes(format.writtenIn),
      `${identify(format)} has writtenIn ${JSON.stringify(format.writtenIn)}; ` +
        `omit it for backend-only, or use "frontend" or "both"`,
    );
  }
});

test("legacyStorage, when present, is the opposite of storage", () => {
  for (const format of NAME_BEARING_MESSAGE_FORMATS) {
    if (format.legacyStorage === undefined) continue;
    assert.ok(
      ["team", "dm"].includes(format.legacyStorage),
      `${identify(format)} has an unusable legacyStorage`,
    );
    assert.notEqual(
      format.legacyStorage,
      format.storage,
      `${identify(format)} lists legacyStorage equal to storage, which says ` +
        `nothing — drop the field or correct it`,
    );
  }
});

test("a format cleared of person names is exactly the one that was checked", () => {
  // 🔴 `carriesPersonName: false` removes a format from the gap list, so it is
  // the one field in this table that can make a leak disappear by assertion
  // rather than by fixing anything. It is pinned for that reason.
  //
  // The cleared one is the legacy `🔓 The role <x> is now open again.` prose:
  // seen rendering in the running app on two of its six rows, and naming only
  // a role. Four of the six are still inferred from their length — recorded as
  // such in the config, not laundered into certainty here.
  assert.deepEqual(
    FORMATS_CLEARED_OF_PERSON_NAMES.map(identify),
    ["prose 🔓"],
    "the set of formats cleared of person names changed. Clearing one takes " +
      "evidence about STORED ROWS, not a reading of the writer — that " +
      "shortcut has produced a wrong answer three times in this audit.",
  );

  // A cleared format must still carry its row ids, because the only way to
  // re-check it later is to look at those rows again.
  for (const format of FORMATS_CLEARED_OF_PERSON_NAMES) {
    assert.ok(
      Array.isArray(format.knownRowIds) && format.knownRowIds.length > 0,
      `${identify(format)} is cleared but lists no knownRowIds, so the claim ` +
        `cannot be re-checked against anything`,
    );
  }
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

test("the scrub reads its prefixes from the traced table, not a local array", () => {
  const source = readSource("src/controllers/userDeletionController.js");

  assert.match(
    source,
    /require\("\.\.\/config\/nameBearingMessageFormats"\)/,
    "userDeletionController no longer imports the traced format table",
  );
  assert.doesNotMatch(
    source,
    /NAME_BEARING_MESSAGE_PREFIXES\s*=\s*\[/,
    "the prefix list is hand-maintained in the controller again — that is the " +
      "arrangement that rotted in the first place",
  );
});
