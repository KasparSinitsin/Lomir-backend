/**
 * The password rule, in one place (it used to be copied into three handlers).
 *
 * At least 8 characters, with at least one letter and one number. "Letter" and
 * "number" mean any script: the rule was `[a-zA-Z]`, which refused a password
 * whose only letter was ß, ä or a Cyrillic one.
 *
 * ⚠️ This rule is not the industry standard: NIST SP 800-63B-4 and OWASP ASVS
 * advise against composition rules and for length plus a check against known
 * leaked passwords. Julia's decision (2026-10-11): keep the rule for now, fix
 * the bug, and treat the change of policy as its own decision — a leaked-
 * password check through an outside service would need a data-protection review.
 *
 * The frontend repeats the rule (RegisterForm, ResetPassword, Settings), and
 * the two must change together.
 */
const PASSWORD_MIN_LENGTH = 8;

// For Joi's .pattern(): lookaheads, so one regex answers "has both".
const PASSWORD_LETTER_AND_NUMBER = /^(?=.*\p{L})(?=.*\p{Nd})/u;

const isAcceptablePassword = (password) =>
  typeof password === "string" &&
  password.length >= PASSWORD_MIN_LENGTH &&
  PASSWORD_LETTER_AND_NUMBER.test(password);

module.exports = {
  PASSWORD_MIN_LENGTH,
  PASSWORD_LETTER_AND_NUMBER,
  isAcceptablePassword,
};
