/**
 * Country detection from a postal code format.
 *
 * A postal code does not identify a country. Four bare digits are used by AT,
 * CH, BE, DK, NO, HU and SI; five by DE, FR, IT, ES and FI. This module used to
 * resolve that ambiguity by guessing - four digits meant NL, five meant DE -
 * which made the later branches for AT, CH, DK, BE, IT, FR and ES unreachable
 * and could answer a lookup with a confidently wrong place: 20099 is Hamburg in
 * Germany and Sesto San Giovanni in Italy.
 *
 * It now returns null whenever the format is ambiguous, so the caller asks
 * instead of guessing.
 */

/**
 * @param {string} postalCode
 * @returns {string|null} ISO country code, or null when the format is ambiguous
 */
function detectCountryCode(postalCode) {
  if (!postalCode) return null;

  const code = postalCode.toString().trim();

  // Letters make these formats unmistakable
  if (/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d$/i.test(code)) return "CA"; // M5H 2N2
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(code)) return "GB"; // SW1A 1AA
  if (/^\d{4}\s?[A-Z]{2}$/i.test(code)) return "NL"; // 1012 AB

  // Distinctive separators
  if (/^\d{2}-\d{3}$/.test(code)) return "PL"; // 12-345
  if (/^\d{4}-\d{3}$/.test(code)) return "PT"; // 1234-567
  if (/^\d{3}\s\d{2}$/.test(code)) return "SE"; // 123 45

  // Everything else - four and five bare digits above all - is ambiguous.
  return null;
}

module.exports = { detectCountryCode };
