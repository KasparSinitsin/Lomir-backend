/**
 * The languages Lomir is offered in, and how a language is derived from a
 * country when the user has not chosen one.
 *
 * This list is the single source of truth on the backend: Joi validates
 * against it, and the transactional mail path reads it to pick a template.
 * (That last clause was aspirational until 2026-09-12 — `resolveUserLanguage`
 * had no caller at all. It is true now; the five user-facing templates in
 * `emailService.js` are selected through it.)
 * Adding a language is an entry here plus its translations - deliberately
 * not a Postgres enum, which would need a migration for every addition.
 */

const DEFAULT_LANGUAGE = "en";

// BCP-47 codes. Kept as plain language subtags for now; the column is a
// varchar, so a regional code ("de-AT") can be stored later without a schema
// change if that ever becomes useful.
const SUPPORTED_LANGUAGES = ["en", "de"];

/**
 * Country (ISO 3166-1 alpha-2) -> language, for users who never picked one.
 *
 * CH and LI are a judgement call: Switzerland is multilingual and German is
 * its largest language, so it is the safest default rather than a correct
 * one - the picker covers everyone it guesses wrong. LU and BE are
 * deliberately absent for the same reason in reverse: French and Dutch
 * majorities make German the wrong guess there.
 */
const COUNTRY_LANGUAGE_MAP = {
  DE: "de",
  AT: "de",
  CH: "de",
  LI: "de",
};

const isSupportedLanguage = (language) =>
  typeof language === "string" && SUPPORTED_LANGUAGES.includes(language);

/**
 * The language implied by a country, or the default. `users.country` holds
 * ISO codes (CountrySelect offers 209 of them and the geocoding path maps
 * names back to codes), so this is a lookup and never string parsing.
 */
const getLanguageForCountry = (countryCode) => {
  if (typeof countryCode !== "string") return DEFAULT_LANGUAGE;
  return COUNTRY_LANGUAGE_MAP[countryCode.trim().toUpperCase()] || DEFAULT_LANGUAGE;
};

/**
 * The language to address a user in, for anything the backend sends on its
 * own (email above all, where no browser is in the loop).
 *
 * An explicit choice outranks the country permanently - re-deriving from the
 * country on every send would silently undo what the user picked. A stored
 * value that is no longer supported is ignored rather than trusted.
 */
const resolveUserLanguage = (user) => {
  if (!user) return DEFAULT_LANGUAGE;

  const stored = user.preferred_language ?? user.preferredLanguage;
  if (isSupportedLanguage(stored)) return stored;

  return getLanguageForCountry(user.country);
};

/**
 * The guard for anything that sends mail.
 *
 * `resolveUserLanguage` is a pure function with a deliberate fallback chain,
 * and it cannot tell the difference between the two reasons a field is absent:
 *
 *   - the user never chose a language     -> key present, value NULL
 *   - the row was loaded by a narrow SELECT -> key not present at all
 *
 * The first is exactly what the country rule exists for. The second is a bug,
 * and on 2026-09-12 it was live at **four of the five** mail call sites in
 * `authController` — `SELECT id, username, email` and friends carry neither
 * `preferred_language` nor `country`, so the resolver fell through to English
 * with no error and nothing in a log. A German user resetting their password
 * got an English mail and nothing anywhere said so.
 *
 * ⚠️ This check deliberately lives here rather than inside
 * `resolveUserLanguage`: two existing tests call that function with objects
 * that have no language key on purpose, to exercise the fallback chain. A
 * warning in there would fire on correct calls and stop meaning anything.
 *
 * Call it at the point where a user row is about to decide a mail's language.
 * It never throws — a missing column must not stop a password reset.
 */
const warnIfMailLanguageFieldsMissing = (user, where) => {
  const hasLanguage =
    !!user && ("preferred_language" in user || "preferredLanguage" in user);
  const hasCountry = !!user && "country" in user;

  if (hasLanguage && hasCountry) return true;

  const missing = [
    !hasLanguage && "preferred_language",
    !hasCountry && "country",
  ]
    .filter(Boolean)
    .join(" and ");

  console.warn(
    `[i18n] ${where}: the user row is missing ${missing}, so the mail language ` +
      `falls back to "${DEFAULT_LANGUAGE}" silently. Widen that SELECT.`,
  );

  return false;
};

module.exports = {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  COUNTRY_LANGUAGE_MAP,
  isSupportedLanguage,
  getLanguageForCountry,
  resolveUserLanguage,
  warnIfMailLanguageFieldsMissing,
};
