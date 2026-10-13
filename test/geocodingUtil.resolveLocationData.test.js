const test = require("node:test");
const assert = require("node:assert/strict");

const axios = require("axios");
const { resolveLocationData } = require("../src/utils/geocodingUtil");

const originalGet = axios.get;

// "No results" is the default: these cases are about what the function keeps
// from its input, not about how well geocoding works.
test.beforeEach(() => {
  axios.get = async () => ({ data: [] });
});

test.afterEach(() => {
  axios.get = originalGet;
});

test("resolveLocationData never carries a state in from the request", async () => {
  // The caller fills missing fields from the stored record, so an incoming
  // state describes the previous location. Saving Wien after Bern used to keep
  // "Bern/Berne" as the state.
  const resolved = await resolveLocationData({
    postal_code: "",
    city: "Wien",
    state: "Bern/Berne",
    district: "Old district",
    country: "AT",
  });

  assert.equal(resolved.state, null);
  assert.equal(resolved.district, null);
  assert.equal(resolved.city, "Wien");
});

test("resolveLocationData drops state and district when city and postal code are cleared", async () => {
  const resolved = await resolveLocationData({
    postal_code: "",
    city: "",
    state: "Bayern",
    district: "Innenstadt",
    country: "DE",
  });

  assert.equal(resolved.state, null);
  assert.equal(resolved.district, null);
  assert.equal(resolved.country, "DE");
});

test("resolveLocationData takes the state from the geocoding result", async () => {
  axios.get = async () => ({
    data: [
      {
        lat: "48.2",
        lon: "16.37",
        address: { city: "Wien", state: "Wien", country_code: "at" },
      },
    ],
  });

  const resolved = await resolveLocationData({
    postal_code: "",
    city: "Wien",
    state: "Bern/Berne",
    country: "AT",
  });

  assert.equal(resolved.state, "Wien");
  assert.equal(resolved.latitude, 48.2);
});

test("resolveLocationData keeps the state the postal code derives locally", async () => {
  // 12557 is in the local derivation table, so a state is available without
  // asking Nominatim at all.
  const resolved = await resolveLocationData({
    postal_code: "12557",
    city: "",
    state: "Bayern",
    country: "DE",
  });

  assert.equal(resolved.state, "Berlin");
  assert.equal(resolved.city, "Berlin");
});

test("resolveLocationData still returns null without a country", async () => {
  const resolved = await resolveLocationData({
    postal_code: "63834",
    city: "Sulzbach am Main",
    state: "Bayern",
    country: "",
  });

  assert.equal(resolved, null);
});
