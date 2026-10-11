const test = require("node:test");
const assert = require("node:assert/strict");
const Joi = require("joi");

const {
  PASSWORD_MIN_LENGTH,
  PASSWORD_LETTER_AND_NUMBER,
  isAcceptablePassword,
} = require("../src/utils/passwordRules");

test("a password with a letter and a number, 8 characters or more, is accepted", () => {
  for (const password of ["abcdefg1", "Straße123", "Passwort2026Oktober"]) {
    assert.equal(isAcceptablePassword(password), true, password);
  }
});

test("a letter of any script counts: ß, umlauts, accents, Cyrillic, Greek", () => {
  // The old rule was [a-zA-Z] and refused each of these.
  for (const password of [
    "ß1234567",
    "ä1234567",
    "é1234567",
    "пароль12345",
    "κωδικός123",
  ]) {
    assert.equal(isAcceptablePassword(password), true, password);
  }
});

test("a number of any script counts as a number", () => {
  assert.equal(isAcceptablePassword("passwort٣٤٥٦٧"), true);
});

test("the rule still refuses what it refused before", () => {
  const refused = {
    "12345678": "no letter",
    abcdefgh: "no number",
    "ßßßßßßßß": "no number",
    "!!!!????": "neither",
    abc1: "too short",
    "ab1": "too short",
    "": "empty",
  };
  for (const [password, why] of Object.entries(refused)) {
    assert.equal(isAcceptablePassword(password), false, `${password} (${why})`);
  }
  assert.equal(isAcceptablePassword(undefined), false);
  assert.equal(isAcceptablePassword(null), false);
  assert.equal(isAcceptablePassword(12345678), false);
});

test("the minimum length is 8", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8);
  assert.equal(isAcceptablePassword("abcdef1"), false);
  assert.equal(isAcceptablePassword("abcdefg1"), true);
});

test("the Joi pattern used at registration agrees with the function", () => {
  const schema = Joi.string().min(PASSWORD_MIN_LENGTH).pattern(PASSWORD_LETTER_AND_NUMBER);
  for (const password of ["ß1234567", "Straße123", "12345678", "abcdefgh", "ab1"]) {
    assert.equal(
      schema.validate(password).error === undefined,
      isAcceptablePassword(password),
      password,
    );
  }
});
