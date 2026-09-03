/**
 * The languages Lomir is offered in, and how a language is derived from a
 * country when the user has not chosen one.
 *
 * This list is the single source of truth on the backend: Joi validates
 * against it, and the transactional mail path reads it to pick a template.
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

module.exports = {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  COUNTRY_LANGUAGE_MAP,
  isSupportedLanguage,
  getLanguageForCountry,
  resolveUserLanguage,
};
