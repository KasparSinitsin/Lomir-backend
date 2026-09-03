const test = require("node:test");
const assert = require("node:assert/strict");

const bcrypt = require("bcrypt");
const db = require("../src/config/database");
const userModel = require("../src/models/userModel");
const {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  getLanguageForCountry,
  resolveUserLanguage,
} = require("../src/config/languages");

const originalQuery = db.query;
const originalHash = bcrypt.hash;

test.afterEach(() => {
  db.query = originalQuery;
  bcrypt.hash = originalHash;
});

test("getLanguageForCountry maps the German-speaking countries and nothing else", () => {
  for (const code of ["DE", "AT", "CH", "LI"]) {
    assert.equal(getLanguageForCountry(code), "de");
  }

  // Excluded on purpose: French and Dutch majorities make German the wrong
  // guess in LU and BE, which is the whole reason they are not in the map.
  for (const code of ["LU", "BE", "FR", "NL", "US", "IT"]) {
    assert.equal(getLanguageForCountry(code), "en");
  }
});

test("getLanguageForCountry is case-insensitive and survives missing input", () => {
  assert.equal(getLanguageForCountry("de"), "de");
  assert.equal(getLanguageForCountry(" at "), "de");
  assert.equal(getLanguageForCountry(null), DEFAULT_LANGUAGE);
  assert.equal(getLanguageForCountry(undefined), DEFAULT_LANGUAGE);
  assert.equal(getLanguageForCountry(""), DEFAULT_LANGUAGE);
});

test("isSupportedLanguage rejects anything not on the list", () => {
  assert.equal(isSupportedLanguage("en"), true);
  assert.equal(isSupportedLanguage("de"), true);
  assert.equal(isSupportedLanguage("fr"), false);
  assert.equal(isSupportedLanguage("DE"), false);
  assert.equal(isSupportedLanguage(null), false);
  assert.equal(isSupportedLanguage(42), false);
});

test("an explicit choice outranks the country, permanently", () => {
  // The classic i18n bug this guards against: an English-speaking user in
  // Germany gets flipped back to German because the country rule re-applies.
  assert.equal(
    resolveUserLanguage({ preferred_language: "en", country: "DE" }),
    "en",
  );
  assert.equal(
    resolveUserLanguage({ preferred_language: "de", country: "US" }),
    "de",
  );
});

test("no explicit choice falls through to the country", () => {
  assert.equal(resolveUserLanguage({ preferred_language: null, country: "AT" }), "de");
  assert.equal(resolveUserLanguage({ country: "FR" }), "en");
  assert.equal(resolveUserLanguage({}), DEFAULT_LANGUAGE);
  assert.equal(resolveUserLanguage(null), DEFAULT_LANGUAGE);
});

test("a stored language that is no longer supported is ignored, not trusted", () => {
  assert.equal(
    resolveUserLanguage({ preferred_language: "fr", country: "DE" }),
    "de",
  );
  assert.equal(
    resolveUserLanguage({ preferred_language: "fr", country: "US" }),
    "en",
  );
});

test("resolveUserLanguage also reads the camelCase spelling", () => {
  // Rows come back snake_case, but callers that already mapped a user object
  // should not silently fall through to the country.
  assert.equal(
    resolveUserLanguage({ preferredLanguage: "de", country: "US" }),
    "de",
  );
});

const stubCreateUser = () => {
  const captured = {};

  bcrypt.hash = async () => "hashed-password";
  db.query = async (sql, params) => {
    captured.sql = sql;
    captured.params = params;
    return { rows: [{ id: 1 }] };
  };

  return captured;
};

const baseUserData = {
  username: "languser",
  email: "lang@example.com",
  password: "secret123",
  accepted_terms_version: "2026-06-15",
  accepted_privacy_version: "2026-06-15",
  confirmed_age_16_version: "2026-06-15",
};

test("createUser persists a chosen language", async () => {
  const captured = stubCreateUser();

  await userModel.createUser({ ...baseUserData, preferred_language: "de" });

  assert.match(captured.sql, /preferred_language/);
  assert.equal(captured.params[captured.params.length - 1], "de");
});

test("createUser stores NULL, not an empty string, when no language was chosen", async () => {
  const captured = stubCreateUser();

  await userModel.createUser({ ...baseUserData, preferred_language: "" });

  // NULL is the value that means "never chose one" and lets the country rule
  // apply. An empty string would read as an explicit choice for nothing.
  assert.equal(captured.params[captured.params.length - 1], null);
});
