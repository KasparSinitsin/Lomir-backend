const test = require("node:test");
const assert = require("node:assert/strict");

const { csrfProtection } = require("../src/middlewares/csrfProtection");
const { AUTH_COOKIE_NAME } = require("../src/utils/authCookie");

const createRequest = ({
  method = "POST",
  headers = {},
  cookies = {},
  originalUrl = "/api/users/1",
} = {}) => {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    method,
    headers: normalizedHeaders,
    cookies,
    originalUrl,
    get(name) {
      return normalizedHeaders[name.toLowerCase()];
    },
  };
};

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

const runMiddleware = (req) => {
  const res = createResponse();
  let nextCalled = false;

  csrfProtection(req, res, () => {
    nextCalled = true;
  });

  return { res, nextCalled };
};

const withSilencedWarnings = (fn) => {
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    return fn();
  } finally {
    console.warn = originalWarn;
  }
};

test("csrfProtection skips safe methods", () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      method: "GET",
      headers: { Origin: "https://evil.example" },
      cookies: { [AUTH_COOKIE_NAME]: "session-token" },
    }),
  );

  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});

test("csrfProtection allows mutating requests from an allowed Origin", () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      headers: { Origin: "https://lomir-frontend.vercel.app" },
      cookies: { [AUTH_COOKIE_NAME]: "session-token" },
    }),
  );

  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});

test("csrfProtection allows mutating requests from an allowed Referer", () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      headers: {
        Referer: "https://lomir-frontend.vercel.app/profile/settings",
      },
      cookies: { [AUTH_COOKIE_NAME]: "session-token" },
    }),
  );

  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});

test("csrfProtection rejects mutating requests from a disallowed Origin", () => {
  const { res, nextCalled } = withSilencedWarnings(() =>
    runMiddleware(
      createRequest({
        headers: { Origin: "https://evil.example" },
        cookies: { [AUTH_COOKIE_NAME]: "session-token" },
      }),
    ),
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    message: "Request origin is not allowed.",
  });
});

test("csrfProtection rejects cookie-authenticated mutating requests without Origin or Referer", () => {
  const { res, nextCalled } = withSilencedWarnings(() =>
    runMiddleware(
      createRequest({
        cookies: { [AUTH_COOKIE_NAME]: "session-token" },
      }),
    ),
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    message: "Request origin is required.",
  });
});

test("csrfProtection allows non-browser mutating requests without browser origin headers", () => {
  const { res, nextCalled } = runMiddleware(createRequest());

  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});

test("csrfProtection allows bearer-token API clients without browser origin headers", () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      headers: { Authorization: "Bearer api-token" },
      cookies: { [AUTH_COOKIE_NAME]: "session-token" },
    }),
  );

  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});
