/**
 * Escape a string for literal use inside a POSIX regular expression.
 *
 * Written for the notification scrub in `userDeletionController`, which matches
 * a deleted user's display name on WORD BOUNDARIES — a deleted "Ana" must not
 * take out a notification about "Anastasia" — and word boundaries need a regex.
 *
 * ⚠️ A display name is user input. Without escaping, `.` matches any character,
 * `*` and `+` quantify whatever precedes them, and an unbalanced `(` or `[`
 * makes Postgres raise `invalid regular expression` **inside the deletion
 * transaction**. A name like `A. B (admin)` would either delete the wrong rows
 * or abort the account deletion.
 *
 * ⚠️ `\` has to BE in the character class — a name containing a backslash would
 * otherwise produce an invalid pattern. Its POSITION in the class does not
 * matter: this is a single pass with `$&`, so every matched character is escaped
 * exactly once. (An earlier comment here claimed the backslash had to come
 * first. That is only true of sequential `.replace()` calls, which this is not,
 * and the claim was removed after a mutation showed the test pinning it could
 * not fail.)
 *
 * 🔴 This lives in its own module, with NO imports, for one specific reason:
 * `userDeletionController` requires `config/database`, so a test that required
 * the controller to reach this function would open a connection to the shared
 * production database. `focusAreaProvenance.test.js` is the recorded case of
 * what that costs — its first run put a `REFRESH MATERIALIZED VIEW` on
 * production. A module with no imports can be required by a test safely, the
 * same arrangement `config/nameBearingMessageFormats.js` uses.
 */
const escapeForPosixRegex = (value) =>
  String(value).replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");

module.exports = { escapeForPosixRegex };
