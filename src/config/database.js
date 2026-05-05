const { Pool, types } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

// Treat TIMESTAMP WITHOUT TIME ZONE as UTC so the pg driver never applies
// local-timezone shifts when constructing JavaScript Date objects.
types.setTypeParser(1114, (str) => new Date(str + 'Z'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};