const multer = require("multer");

// The registration form arrives as multipart/form-data. Its text fields are
// read; any file in it is dropped unread.
//
// 🔴 There is no avatar at registration (STATUS item 59, decided 2026-10-12).
// A picture is uploaded from the profile, after the e-mail confirmation, so an
// account that is never confirmed never leaves a file in ImageKit. Until then
// the backend uploaded the avatar BEFORE the input checks and Turnstile, and a
// failed registration or an expired unverified account left the file behind.
//
// Files are skipped rather than refused, so a browser still holding the old
// form, which sent an `avatar` file, can register without it.
const parseRegistrationForm = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => cb(null, false),
}).any();

module.exports = { parseRegistrationForm };
