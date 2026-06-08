const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveLocationFromPostalCode,
} = require("../src/utils/locationDerivation");

test("deriveLocationFromPostalCode resolves Berlin postal-code districts", () => {
  assert.deepEqual(deriveLocationFromPostalCode("12557", "DE"), {
    city: "Berlin",
    state: "Berlin",
    country: "Germany",
    district: "Köpenick",
  });
});

test("deriveLocationFromPostalCode resolves Frankfurt postal-code districts", () => {
  assert.deepEqual(deriveLocationFromPostalCode("60308", "DE"), {
    city: "Frankfurt am Main",
    state: "Hessen",
    country: "Germany",
    district: "Westend-Süd",
  });
});

test("deriveLocationFromPostalCode resolves Frankfurt Bahnhofsviertel", () => {
  assert.deepEqual(deriveLocationFromPostalCode("60329", "DE"), {
    city: "Frankfurt am Main",
    state: "Hessen",
    country: "Germany",
    district: "Bahnhofsviertel",
  });
});
