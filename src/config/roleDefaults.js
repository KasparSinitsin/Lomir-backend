/**
 * The name a role carries when nobody gave it one.
 *
 * ⚠️ **Stored data, not UI copy.** This string is written into chat event
 * markers, notification titles and notification messages, so it becomes part of
 * a transcript that is never rewritten. It stays English for the same reason a
 * user's own role name does.
 *
 * It was `"Vacant Role"` until **2026-09-28**. Anything reading stored text
 * must tolerate both spellings and rewrite neither — a chat from 18 May 2026
 * still shows the old one, and a user may also have typed either by hand.
 *
 * 🔴 **The frontend has its own copy in `src/constants/roleDefaults.js` and the
 * two must agree**, because both write this name into stored content. Same
 * cross-repo shape as `config/teamErrors.js` ↔ `utils/teamErrorText.js`.
 */
const DEFAULT_ROLE_NAME = "Open Role";

module.exports = { DEFAULT_ROLE_NAME };
