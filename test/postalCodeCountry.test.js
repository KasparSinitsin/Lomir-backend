const test = require("node:test");
const assert = require("node:assert/strict");

const { detectCountryCode } = require("../src/utils/postalCodeCountry");

test("detectCountryCode returns null for bare four-digit codes", () => {
  // Vienna, Zurich, Bern, Amsterdam - AT, CH, BE, DK, NO, HU and SI all use
  // four digits, so the format cannot single one out.
  for (const code of ["1010", "8001", "3000", "1012"]) {
    assert.equal(detectCountryCode(code), null, `expected null for ${code}`);
  }
});

test("detectCountryCode returns null for bare five-digit codes", () => {
  // 20099 is the case that made this a bug rather than a wart: Hamburg in
  // Germany, Sesto San Giovanni in Italy. Guessing "DE" gave the Italian user
  // Hamburg and wrote country=DE into their profile.
  for (const code of ["10115", "20099", "75001", "28001", "00185"]) {
    assert.equal(detectCountryCode(code), null, `expected null for ${code}`);
  }
});

test("detectCountryCode recognizes formats that carry letters", () => {
  assert.equal(detectCountryCode("SW1A 1AA"), "GB");
  assert.equal(detectCountryCode("M5H 2N2"), "CA");
  assert.equal(detectCountryCode("1012 AB"), "NL");
  assert.equal(detectCountryCode("1012AB"), "NL");
});

test("detectCountryCode recognizes formats with distinctive separators", () => {
  assert.equal(detectCountryCode("12-345"), "PL");
  assert.equal(detectCountryCode("1234-567"), "PT");
  assert.equal(detectCountryCode("123 45"), "SE");
});

test("detectCountryCode handles empty input and surrounding whitespace", () => {
  assert.equal(detectCountryCode(""), null);
  assert.equal(detectCountryCode(null), null);
  assert.equal(detectCountryCode(undefined), null);
  assert.equal(detectCountryCode("  SW1A 1AA  "), "GB");
});
