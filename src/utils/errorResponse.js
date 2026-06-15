const normalizeStatusCode = (statusCode) => {
  const numericStatusCode = Number(statusCode);

  return Number.isInteger(numericStatusCode) &&
    numericStatusCode >= 400 &&
    numericStatusCode < 600
    ? numericStatusCode
    : 500;
};

const buildErrorResponse = (err, nodeEnv = process.env.NODE_ENV) => {
  const statusCode = normalizeStatusCode(err?.statusCode || err?.status || 500);
  const fallbackMessage =
    statusCode >= 500 ? "Internal server error" : "Request failed";
  const message =
    nodeEnv === "production" && statusCode >= 500
      ? fallbackMessage
      : err?.message || fallbackMessage;

  const body = {
    success: false,
    message,
  };

  if (nodeEnv === "development") {
    body.error = err?.stack;
  }

  return { statusCode, body };
};

module.exports = {
  buildErrorResponse,
  normalizeStatusCode,
};
