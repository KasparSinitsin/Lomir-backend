const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  warnIfMailLanguageFieldsMissing,
  DEFAULT_LANGUAGE,
} = require("../src/config/languages");

/**
 * The bug these tests exist for, found 2026-09-12:
 *
 * Four of the five mail call sites in `authController` loaded the user with a
 * narrow SELECT — `SELECT id, username, email` and friends — which carries
 * neither `preferred_language` nor `country`. `resolveUserLanguage` then found
 * nothing to go on and returned DEFAULT_LANGUAGE. A German user resetting their
 * password would have received an English mail, with **no error and nothing in
 * any log**.
 *
 * ⚠️ These tests deliberately assert the PLUMBING, not the translation. The
 * translation is visible the moment it is wrong; a column quietly missing from
 * a SELECT is not, and that is the failure that needs a guard around it.
 */

const captureWarnings = (fn) => {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    return { result: fn(), lines };
  } finally {
    console.warn = original;
  }
};

test("the guard stays silent when both fields are present", () => {
  const { result, lines } = captureWarnings(() =>
    warnIfMailLanguageFieldsMissing(
      { preferred_language: "de", country: "DE" },
      "test",
    ),
  );
  assert.equal(result, true);
  assert.deepEqual(lines, []);
});

test("present-but-NULL is legitimate and must NOT warn", () => {
  // This is the case the country rule exists for: a user who never chose a
  // language. Warning here would make the guard meaningless.
  const { result, lines } = captureWarnings(() =>
    warnIfMailLanguageFieldsMissing(
      { preferred_language: null, country: null },
      "test",
    ),
  );
  assert.equal(result, true);
  assert.deepEqual(lines, []);
});

test("a missing key warns and names both the field and the call site", () => {
  const { result, lines } = captureWarnings(() =>
    warnIfMailLanguageFieldsMissing({ id: 1, email: "a@b.c" }, "password reset"),
  );
  assert.equal(result, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /password reset/);
  assert.match(lines[0], /preferred_language/);
  assert.match(lines[0], /country/);
  assert.match(lines[0], new RegExp(DEFAULT_LANGUAGE));
});

test("the camelCase spelling counts as present", () => {
  const { lines } = captureWarnings(() =>
    warnIfMailLanguageFieldsMissing(
      { preferredLanguage: "de", country: "DE" },
      "test",
    ),
  );
  assert.deepEqual(lines, []);
});

test("a null user warns rather than throwing", () => {
  const { result, lines } = captureWarnings(() =>
    warnIfMailLanguageFieldsMissing(null, "test"),
  );
  assert.equal(result, false);
  assert.equal(lines.length, 1);
});

/**
 * The invariant that catches the NEXT call site, not this one.
 *
 * Unit-testing the guard proves the guard works; it does not prove anyone calls
 * it. A sixth mail path added later would reintroduce the exact bug — so the
 * count has to match, and this test fails loudly when it does not.
 */
test("every emailService send call in authController is guarded", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "controllers", "authController.js"),
    "utf8",
  );
  const sends = src.match(/emailService\.send\w+\(/g) || [];
  // The trailing "(" is what separates a call from the destructured import,
  // which reads "warnIfMailLanguageFieldsMissing," — so no adjustment is
  // needed here. Subtracting one for the import was this test's first bug.
  const guardCalls = (src.match(/warnIfMailLanguageFieldsMissing\(/g) || []).length;

  assert.ok(sends.length >= 5, `expected at least 5 mail calls, found ${sends.length}`);
  assert.equal(
    guardCalls,
    sends.length,
    `${sends.length} mail calls but ${guardCalls} guards — a mail path was added ` +
      `without warnIfMailLanguageFieldsMissing, and its language will fall back ` +
      `to "${DEFAULT_LANGUAGE}" in silence`,
  );
});

test("the four user lookups that feed a mail load both language fields", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "controllers", "authController.js"),
    "utf8",
  );
  // Each lookup is named by the WHERE clause that makes it unique, so the test
  // does not break when a column order changes.
  const lookups = [
    ["resend verification", /SELECT[^;]*?email_verified,[^;]*?FROM users\s*\n\s*WHERE LOWER\(email\)/],
    ["password reset", /SELECT id, username, email, preferred_language, country\s*\n\s*FROM users\s*\n\s*WHERE LOWER\(email\)/],
    ["password changed", /SELECT[^"]*password_hash[^"]*WHERE id = \$1/],
    ["email change", /SELECT id, username, password_hash, email[^"]*WHERE id = \$1/],
  ];
  for (const [where, re] of lookups) {
    const m = src.match(re);
    assert.ok(m, `could not locate the ${where} lookup — has the query changed?`);
    assert.match(m[0], /preferred_language/, `${where}: SELECT is missing preferred_language`);
    assert.match(m[0], /\bcountry\b/, `${where}: SELECT is missing country`);
  }
});
