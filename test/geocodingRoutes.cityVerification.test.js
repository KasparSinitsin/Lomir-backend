const test = require("node:test");
const assert = require("node:assert/strict");

const axios = require("axios");
const router = require("../src/routes/geocodingRoutes");

// Pull the handler out of the router stack rather than starting a server: the
// project has no HTTP test client, and the router stack is the same source of
// truth used elsewhere to reason about routes.
const layer = router.stack.find(
  (entry) => entry.route && entry.route.path === "/city/:name",
);
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

const originalGet = axios.get;

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

test.afterEach(() => {
  axios.get = originalGet;
});

test("city verification reports a town that does not exist in the country", async () => {
  axios.get = async () => ({ data: [] });

  const res = createResponse();
  await handler({ params: { name: "Berlin" }, query: { country: "AT" } }, res);

  assert.equal(res.body.found, false);
  assert.equal(res.body.city, null);
});

test("city verification returns the resolved town and its postal code", async () => {
  axios.get = async () => ({
    data: [
      {
        lat: "49.9",
        lon: "9.15",
        display_name: "Sulzbach am Main, Bayern, 63834, Deutschland",
        address: { town: "Sulzbach am Main", state: "Bayern", postcode: "63834" },
      },
    ],
  });

  const res = createResponse();
  await handler(
    { params: { name: "Sulzbach am Main" }, query: { country: "DE" } },
    res,
  );

  assert.equal(res.body.found, true);
  assert.equal(res.body.city, "Sulzbach am Main");
  assert.equal(res.body.postalCode, "63834");
  assert.equal(res.body.state, "Bayern");
});

test("city verification asks Nominatim for settlements only", async () => {
  // The regression this guards: without the settlement filter, "Bern" in
  // Austria matched BERN-001, an industrial landuse area near Berndorf, and the
  // route answered found: true for a town that does not exist there.
  let sentParams = null;
  axios.get = async (_url, config) => {
    sentParams = config.params;
    return { data: [] };
  };

  const res = createResponse();
  await handler({ params: { name: "Bern" }, query: { country: "AT" } }, res);

  assert.equal(sentParams.featureType, "settlement");
  assert.equal(sentParams.city, "Bern");
  assert.equal(sentParams.countrycodes, "at");
  assert.equal(res.body.found, false);
});

test("city verification never reports 'not found' when the lookup itself failed", async () => {
  axios.get = async () => {
    throw new Error("Nominatim unreachable");
  };

  const res = createResponse();
  // A name no other test uses: the route's cache is module-level and lives for
  // the whole run, so reusing one would answer from it and never reach the
  // failure path being tested here.
  await handler(
    { params: { name: "Unreachableton" }, query: { country: "AT" } },
    res,
  );

  // null, not false: an outage must never be read as evidence that a town does
  // not exist, or a service hiccup would delete correct data.
  assert.equal(res.body.found, null);
  assert.equal(res.body.unavailable, true);
});

test("city verification asks for a country instead of guessing", async () => {
  let called = false;
  axios.get = async () => {
    called = true;
    return { data: [] };
  };

  const res = createResponse();
  await handler({ params: { name: "Berlin" }, query: {} }, res);

  assert.equal(res.body.needsCountry, true);
  assert.equal(res.body.found, null);
  assert.equal(called, false, "no outbound request without a country");
});
