/**
 * The failure codes `/api/contact` can answer with.
 *
 * ⚠️ **This is the first API surface in Lomir to send codes rather than only
 * prose, so the shape here is the precedent for the rest of decision 7.** Read
 * this before adding a second group.
 *
 * The rule it implements: *a text needs translating only where a human reads
 * it.* Email is the one thing the backend writes for a person; everywhere else
 * it emits data and the frontend formulates. An error message shown in a form
 * is read by a human, but the backend has no idea which language that human is
 * reading in — so it names **what went wrong** and lets the frontend say it.
 *
 * The wire shape, flat beside the existing `{ success, message, data }`:
 *
 *     {
 *       success: false,
 *       code: "ATTACHMENT_TOO_LARGE",   // stable, never shown to anyone
 *       values: { fileName: "foto.png" },  // only what the sentence needs
 *       message: "foto.png: Each file must be 5 MB or smaller."
 *     }
 *
 * ⚠️ **`message` stays, and that is deliberate.** It makes this change additive
 * in both directions: an old frontend keeps reading `message` and is unaffected,
 * and a new frontend that meets an old backend finds no `code` and falls back
 * to `message`. **So this needs no deploy order** — unlike the topic codes,
 * which did, and which cost the release a fifth ordering constraint. Design for
 * that on purpose when adding the next group.
 *
 * ⚠️ **SCREAMING_SNAKE, not a dotted path.** A code that looked like
 * `contact.attachment.tooLarge` invites `t(code)` at the consumer — a dynamic
 * key, which `npm run i18n:check` cannot verify and would report as unused.
 * The codes are deliberately not spellable as translation keys; the frontend
 * maps them through an explicit switch of literals.
 *
 * ⚠️ **Keep every key in an error payload camelCase.** The frontend's axios
 * response interceptor applies `snakeToCamel` to SUCCESS responses only — its
 * error handler logs and re-throws without transforming (`services/api.js`).
 * So `file_name` would arrive as `file_name` here and as `fileName` on a 200,
 * which is the kind of asymmetry that costs an afternoon. `fileName` below is
 * camelCase for that reason, not by accident.
 *
 * `values` carries only what the backend alone knows — the file name. Limits
 * like "5 MB" are NOT sent: the frontend has its own constants and puts them
 * in the sentence itself.
 * ⚠️ Those limits are duplicated across the repos today (3 files / 5 MB /
 * 10 MB in both `contactAttachments.js` and `Contact.jsx`). That predates this
 * change and is not made worse by it, but a mismatch would now show as a
 * sentence quoting a limit the backend did not enforce.
 */

const CONTACT_ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
  CAPTCHA_FAILED: "CAPTCHA_FAILED",

  ATTACHMENT_NAME_UNSUPPORTED: "ATTACHMENT_NAME_UNSUPPORTED",
  ATTACHMENT_TYPE_UNSUPPORTED: "ATTACHMENT_TYPE_UNSUPPORTED",
  ATTACHMENT_EMPTY: "ATTACHMENT_EMPTY",
  ATTACHMENT_TOO_LARGE: "ATTACHMENT_TOO_LARGE",
  ATTACHMENT_TOO_MANY: "ATTACHMENT_TOO_MANY",
  ATTACHMENT_TOTAL_TOO_LARGE: "ATTACHMENT_TOTAL_TOO_LARGE",
  ATTACHMENT_UPLOAD_FAILED: "ATTACHMENT_UPLOAD_FAILED",

  REPORT_PERSIST_FAILED: "REPORT_PERSIST_FAILED",
  CONTACT_FAILED: "CONTACT_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
};

module.exports = { CONTACT_ERROR_CODES };
