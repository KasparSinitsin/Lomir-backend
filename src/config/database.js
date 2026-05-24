const { Pool, types } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

// Treat TIMESTAMP WITHOUT TIME ZONE as UTC so the pg driver never applies
// local-timezone shifts when constructing JavaScript Date objects.
types.setTypeParser(1114, (str) => new Date(str + 'Z'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Increase pool size to handle bursts of concurrent requests.
  // Default is 10, which gets exhausted when many API calls fire at once
  // (especially with React StrictMode double-invoking effects in development).
  max: 20,
  // Close idle connections after 30 s to free up DB server resources
  idleTimeoutMillis: 30000,
  // Fail fast if the pool is busy rather than hanging indefinitely
  connectionTimeoutMillis: 5000,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};