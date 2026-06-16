const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://lomir-frontend.vercel.app",
];

const getExplicitOrigins = () =>
  [
    ...DEFAULT_ALLOWED_ORIGINS,
    process.env.CLIENT_URL,
    process.env.FRONTEND_URL,
    process.env.FRONTEND_ORIGIN,
  ].filter(Boolean);

const normalizeOrigin = (origin) => {
  if (!origin) return origin;
  return String(origin).trim().replace(/\/+$/, "");
};

const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  const normalizedExplicit = getExplicitOrigins().map(normalizeOrigin);

  if (normalizedExplicit.includes(normalized)) {
    return true;
  }

  try {
    const url = new URL(normalized);

    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return true;
    }

    if (
      url.protocol === "https:" &&
      (url.hostname === "lomir-frontend.vercel.app" ||
        /^lomir-frontend-[a-z0-9]+-juliabaurs-projects\.vercel\.app$/.test(
          url.hostname,
        ))
    ) {
      return true;
    }
  } catch (error) {
    return false;
  }

  return false;
};

const getOriginFromReferer = (referer) => {
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch (error) {
    return null;
  }
};

module.exports = {
  getOriginFromReferer,
  isAllowedOrigin,
  normalizeOrigin,
};
