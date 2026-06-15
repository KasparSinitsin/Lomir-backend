const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildErrorResponse,
  normalizeStatusCode,
} = require("../src/utils/errorResponse");

test("buildErrorResponse hides server error details in production", () => {
  const err = new Error("database password leaked in stack");
  err.statusCode = 500;

  const response = buildErrorResponse(err, "production");

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    success: false,
    message: "Internal server error",
  });
});

test("buildErrorResponse keeps client error messages in production", () => {
  const err = new Error("Validation failed");
  err.statusCode = 400;

  const response = buildErrorResponse(err, "production");

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    success: false,
    message: "Validation failed",
  });
});

test("buildErrorResponse includes stack traces only in development", () => {
  const err = new Error("Debug me");
  err.statusCode = 500;
  err.stack = "stack trace";

  const response = buildErrorResponse(err, "development");

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    success: false,
    message: "Debug me",
    error: "stack trace",
  });
});

test("normalizeStatusCode falls back to 500 for invalid status codes", () => {
  assert.equal(normalizeStatusCode(200), 500);
  assert.equal(normalizeStatusCode("nope"), 500);
  assert.equal(normalizeStatusCode("404"), 404);
});
