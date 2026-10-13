// The deletion scrub must look for EVERY spelling of a departed person's name,
// not just the one `[first_name, last_name].join(" ")` happens to produce.
//
// 🔴 Why this file exists. One `users` row in 177 has a trailing space in
// `first_name` (`deletion-audit/15`). `deleteUser` assembled its match name
// with `join(" ")`, so it searched a DOUBLE-spaced name while the stored rows
// mostly held the single-spaced one. `16` measured the cost: **273** marker
// rows, **553** notification titles and **242** notification messages were
// unreachable — inside BE #347 and #348, both merged and both walked.
//
// ⚠️ The failure mode is what makes this test necessary rather than nice:
// `REPLACE` finds nothing, reports nothing, and the scrub returns green. Every
// other test in this suite uses a clean name, so none of them can see it.
//
// ⚠️ The config module is REQUIRED directly because it has no imports. The
// controller is read as TEXT, never required — `userDeletion.namePrefixes.test.js`
// records why: requiring it pulls in the database module, and one test run that
// did so put a `REFRESH MATERIALIZED VIEW` on the production database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildScrubNameCandidates,
} = require("../src/config/nameBearingMessageFormats");

const controllerSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "controllers", "userDeletionController.js"),
  "utf8",
);

test("a trailing space in first_name yields BOTH spellings", () => {
  const candidates = buildScrubNameCandidates({
    first_name: "Anna ",
    last_name: "Kowalski",
    username: "anna",
  });

  // This is the real row: `15` found it, `16` priced it.
  assert.ok(candidates.includes("Anna  Kowalski"), "raw spelling missing");
  assert.ok(candidates.includes("Anna Kowalski"), "collapsed spelling missing");
  assert.ok(candidates.includes("anna"));
});

test("🔴 the RAW spelling is never dropped in favour of the collapsed one", () => {
  const candidates = buildScrubNameCandidates({
    first_name: "Anna ",
    last_name: "Kowalski",
  });

  // The load-bearing assertion against a future "simplification". The 60
  // most recent rows naming this person carry the DOUBLE-spaced name, because
  // they were written after the space was introduced (`17` section C: nothing
  // single-spaced after 2026-07-20, nothing double-spaced before 2026-09-09).
  // Keeping only the collapsed form would trade 273 unreachable rows for 60.
  assert.equal(candidates[0], "Anna  Kowalski");
  assert.equal(candidates.length, 2);
});

test("a leading space in last_name is covered too", () => {
  const candidates = buildScrubNameCandidates({
    first_name: "Bob",
    last_name: " Stone",
  });

  assert.ok(candidates.includes("Bob  Stone"));
  assert.ok(candidates.includes("Bob Stone"));
});

test("an internal double space is covered", () => {
  const candidates = buildScrubNameCandidates({
    first_name: "Carol  Maria",
    last_name: "Day",
  });

  assert.ok(candidates.includes("Carol  Maria Day"));
  assert.ok(candidates.includes("Carol Maria Day"));
});

test("a clean name costs nothing - the two spellings collapse to one", () => {
  const candidates = buildScrubNameCandidates({
    first_name: "Bob",
    last_name: "Stone",
    username: "bob",
  });

  // 176 of 177 users are in this case, so the extra candidate must not turn
  // into an extra REPLACE pass over the table for all of them.
  assert.deepEqual(candidates, ["Bob Stone", "bob"]);
});

test("a username equal to the name is not duplicated", () => {
  const candidates = buildScrubNameCandidates({
    first_name: "Bob",
    last_name: "Stone",
    username: "Bob Stone",
  });

  assert.deepEqual(candidates, ["Bob Stone"]);
});

test("an account with no names falls back to the username alone", () => {
  assert.deepEqual(
    buildScrubNameCandidates({ username: "ghost" }),
    ["ghost"],
  );
  assert.deepEqual(
    buildScrubNameCandidates({ first_name: null, last_name: "", username: "ghost" }),
    ["ghost"],
  );
});

test("nothing blank or nullish ever reaches the scrub", () => {
  // ⚠️ A blank needle would make `REPLACE(content, '', x)` rewrite everything.
  // `deleteUser`'s own comment flags this; the filter is why it holds.
  for (const user of [
    {},
    { first_name: "", last_name: "", username: "" },
    { first_name: "   ", last_name: "   " },
    null,
    undefined,
  ]) {
    const candidates = buildScrubNameCandidates(user);
    assert.ok(
      candidates.every((c) => typeof c === "string" && c.trim() !== ""),
      `blank candidate for ${JSON.stringify(user)}`,
    );
  }
});

test("a whitespace-only name produces no candidates at all", () => {
  assert.deepEqual(buildScrubNameCandidates({ first_name: "  ", last_name: " " }), []);
});

test("🔴 the controller USES the helper and no longer builds the list inline", () => {
  // A correct helper that nobody calls is exactly the defect the FE #661 walk
  // found hours earlier: a new option added to two functions and not one of
  // their three call sites updated. Behaviour tests passed there too.
  assert.match(
    controllerSource,
    /const namesToScrub = buildScrubNameCandidates\(user\);/,
    "deleteUser does not call buildScrubNameCandidates",
  );
  assert.match(
    controllerSource,
    /buildScrubNameCandidates,\n\} = require\("\.\.\/config\/nameBearingMessageFormats"\);/,
    "the helper is not imported from the config module",
  );
  assert.doesNotMatch(
    controllerSource,
    /new Set\(\[fullName, user\.username\]\)/,
    "the old inline one-spelling list is still there",
  );
});
