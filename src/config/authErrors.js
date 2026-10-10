/**
 * The failure codes the account endpoints can answer with: registration, login,
 * email verification, password reset, and the password and email changes.
 *
 * Same shape and rules as `config/contactErrors.js` and `config/teamErrors.js`:
 * `code` is stable and never shown, `message` stays so an old frontend keeps
 * working and no deploy order arises, every payload key is camelCase.
 *
 * ⚠️ **Only the failures a user can reach carry a code.** The password rule
 * (8 characters, a letter and a number) is checked by the frontend first, so the
 * server's sentence for it stays prose and the frontend shows its own fallback.
 * `Invalid input data` and its `errors` list likewise stay prose (decision of
 * 2026-10-09: treated apart from this change).
 *
 * ⚠️ **One code, two causes, on purpose:** `INVALID_CREDENTIALS` answers an
 * unknown email and a wrong password alike, so that nobody can learn from login
 * whether an address is registered. Do not split it.
 *
 * ⚠️ **`EMAIL_NOT_VERIFIED` is answered only after the password matched**
 * (`authController.login`), so it confirms nothing to a stranger.
 *
 * ⚠️ **`EMAIL_IN_USE` is the one place that confirms an address is registered**
 * (the email change, for a logged-in user who gave the right current password).
 * Giving it a code changes no behaviour; whether to answer neutrally is
 * STATUS item 50.
 *
 * `PASSWORD_INCORRECT` is used for the current password in the email and
 * password change AND for the password that confirms an account deletion
 * (`userDeletionController`): the same situation for the person reading it.
 */

const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",

  USERNAME_TAKEN: "USERNAME_TAKEN",
  CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
  CAPTCHA_FAILED: "CAPTCHA_FAILED",

  // Also answered when the link carries no token at all: a cut-off link.
  VERIFICATION_TOKEN_INVALID: "VERIFICATION_TOKEN_INVALID",
  EMAIL_CHANGE_TOKEN_INVALID: "EMAIL_CHANGE_TOKEN_INVALID",
  RESET_TOKEN_INVALID: "RESET_TOKEN_INVALID",

  PASSWORD_INCORRECT: "PASSWORD_INCORRECT",
  PASSWORD_UNCHANGED: "PASSWORD_UNCHANGED",
  EMAIL_UNCHANGED: "EMAIL_UNCHANGED",
  EMAIL_IN_USE: "EMAIL_IN_USE",

  // Login, registration and the account changes; the frontend says it without a
  // number of minutes, the windows differ.
  RATE_LIMITED: "RATE_LIMITED",
};

module.exports = { AUTH_ERROR_CODES };
