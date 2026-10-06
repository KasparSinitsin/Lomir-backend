// The five PROSE chat events must name people with an `id:name` token, so the
// frontend can resolve the current name at display time instead of showing the
// one frozen into the message when it was written.
//
// 🔴 Why this file exists. `👋 joined`, `🎯 assigned`, `🎯 accepted` and
// `🎉 applied successfully` carried a BARE NAME. A rename never reached those
// banners (`STATUS.md` item 12), and a deletion could only be handled by
// rewriting stored rows — which is how the message scrub came to exist at all.
//
// ⚠️ The dangerous direction is a token the parser cannot split. The frontend
// matches `^(\d+)\s*:(.+)$`; anything else is taken as the person's NAME, so a
// malformed token puts `"abc:Anna Kowalski"` on screen. `idNameToken` must
// therefore degrade to the bare name — the old output — rather than guess.
//
// ⚠️ The controllers are read as TEXT, never required.
// `userDeletion.namePrefixes.test.js` records why: requiring one pulls in the
// database module, and a run that did so put a `REFRESH MATERIALIZED VIEW` on
// the production database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { idNameToken } = require("../src/utils/eventNameToken");

const readController = (name) =>
  fs.readFileSync(
    path.join(__dirname, "..", "src", "controllers", name),
    "utf8",
  );

// The exact pattern the frontend parser uses (messageSystemParser.js).
const PARSER_TOKEN = /^(\d+)\s*:(.+)$/;

test("a positive integer id produces a token the frontend parser splits", () => {
  const token = idNameToken(157, "Anna Kowalski");
  assert.equal(token, "157:Anna Kowalski");

  const match = token.match(PARSER_TOKEN);
  assert.ok(match, "the parser pattern must match the token we emit");
  assert.equal(Number(match[1]), 157);
  assert.equal(match[2], "Anna Kowalski");
});

test("a numeric string id is accepted — pg returns ids as strings", () => {
  assert.equal(idNameToken("157", "Anna Kowalski"), "157:Anna Kowalski");
});

test("the name is trimmed, so a stray stored space cannot reach the token", () => {
  // One `users` row in 177 has a trailing space in `first_name`
  // (`deletion-audit/15`), and the assembled name inherits it.
  assert.equal(idNameToken(157, "  Anna Kowalski  "), "157:Anna Kowalski");
});

test("every non-id degrades to the BARE NAME, never to a visible token", () => {
  for (const bad of [null, undefined, "", "abc", 0, -5, 1.5, NaN, {}, []]) {
    const token = idNameToken(bad, "Anna Kowalski");
    assert.equal(
      token,
      "Anna Kowalski",
      `id ${JSON.stringify(bad)} must fall back to the bare name`,
    );
    assert.equal(
      PARSER_TOKEN.test(token),
      false,
      `id ${JSON.stringify(bad)} must not produce something id-shaped`,
    );
  }
});

test("a missing name yields an empty string, not a dangling id", () => {
  for (const bad of ["", "   ", null, undefined, 42]) {
    assert.equal(idNameToken(157, bad), "");
  }
});

test("a name that already looks like a token still splits to the real id", () => {
  // Defensive: if a stored name began with digits and a colon, the id we
  // prepend must still be the one the parser reads.
  const token = idNameToken(157, "2:1 win");
  const match = token.match(PARSER_TOKEN);
  assert.equal(Number(match[1]), 157);
  assert.equal(match[2], "2:1 win");
});

test("all four 👋 / 🎯 banners interpolate the token, not the bare name", () => {
  const source = readController("invitationController.js");

  assert.match(
    source,
    /const inviteeToken = idNameToken\(\s*invitation\.invitee_id,\s*inviteeName,?\s*\)/,
    "the invitee token must be built from invitation.invitee_id",
  );

  for (const sentence of [
    "was assigned the role",
    "accepted a role invitation!",
    "joined the team as",
    "joined the team!",
  ]) {
    const line = source
      .split("\n")
      .find((l) => l.includes(sentence) && l.includes("joinLine"));
    assert.ok(line, `no joinLine found for "${sentence}"`);
    assert.ok(
      line.includes("${inviteeToken}"),
      `"${sentence}" still interpolates a bare name: ${line.trim()}`,
    );
    assert.ok(
      !line.includes("${inviteeName}"),
      `"${sentence}" must not use inviteeName directly: ${line.trim()}`,
    );
  }
});

test("the 🎉 banner tokenises BOTH people in the sentence", () => {
  const source = readController("teamApplicationsController.js");

  assert.match(
    source,
    /idNameToken\(\s*application\.applicant_id,\s*applicantName,?\s*\)/,
    "the applicant token must come off the application row",
  );
  assert.match(
    source,
    /const approverToken = idNameToken\(userId, approverName\)/,
    "the approver is the acting user",
  );

  const line = source
    .split("\n")
    .find((l) => l.includes("has applied successfully to your team"));
  assert.ok(line, "the 🎉 sentence is gone — has it been renamed?");
  assert.ok(line.includes("${applicantToken}"), "applicant must be a token");
  assert.ok(line.includes("${approverToken}"), "approver must be a token");
  assert.ok(
    !line.includes("${applicantName}") && !line.includes("${approverName}"),
    `the 🎉 sentence still interpolates a bare name: ${line.trim()}`,
  );
});
