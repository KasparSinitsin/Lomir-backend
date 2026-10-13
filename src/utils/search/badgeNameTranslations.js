/**
 * The seeded badges by their stored English name, with the German name the
 * frontend shows for them.
 *
 * Search matches a typed term against BOTH names, so "Empathisch" finds the
 * people holding "Empathetic" whatever language the interface is in. The
 * database only knows the English name; the German one lives in the frontend
 * (`utils/badgeLabels.js` and `locales/de/common.json`, key `badges.names`).
 * This list is a copy of that pairing, made on 2026-10-09 by script.
 *
 * A badge added to the table later is found by its English name only until it
 * is listed here, and in the frontend: the same accepted cost as there.
 * Keep the two in step; `test/badgeNameTranslations.test.js` checks the shape.
 */
const BADGE_NAME_TRANSLATIONS = [
  ["Team Player", "Teamplayer"],
  ["Mediator", "Vermittler"],
  ["Communicator", "Kommunikator"],
  ["Motivator", "Motivator"],
  ["Organizer", "Organisator"],
  ["Reliable", "Verlässlich"],
  ["Coder", "Programmierer"],
  ["Designer", "Designer"],
  ["Data Whiz", "Datenprofi"],
  ["Tech Support", "Technischer Support"],
  ["Systems Thinker", "Systemdenker"],
  ["Documentation Master", "Dokumentationsprofi"],
  ["Innovator", "Innovator"],
  ["Problem Solver", "Problemlöser"],
  ["Visionary", "Visionär"],
  ["Storyteller", "Storyteller"],
  ["Artisan", "Künstler"],
  ["Outside-the-Box", "Unkonventionell"],
  ["Decision Maker", "Entscheider"],
  ["Mentor", "Mentor"],
  ["Initiative Taker", "Initiativkraft"],
  ["Delegator", "Delegierer"],
  ["Strategic Planner", "Stratege"],
  ["Feedback Provider", "Feedback-Geber"],
  ["Quick Learner", "Schnelllerner"],
  ["Empathetic", "Empathisch"],
  ["Persistent", "Beharrlich"],
  ["Detail-Oriented", "Detailorientiert"],
  ["Adaptable", "Anpassungsfähig"],
  ["Knowledge Sharer", "Wissensvermittler"],
];

const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

// A constant derived from the list above, never from user input.
const BADGE_NAME_TRANSLATIONS_VALUES_SQL = BADGE_NAME_TRANSLATIONS.map(
  ([en, de]) => `(${sqlLiteral(en)}, ${sqlLiteral(de)})`,
).join(", ");

module.exports = {
  BADGE_NAME_TRANSLATIONS,
  BADGE_NAME_TRANSLATIONS_VALUES_SQL,
};
