/**
 * The guard of the demo setup (`npm run db:setup`, `npm run seed:demo`).
 *
 * 🔴 Why it exists: local development and the live app can share ONE database (the
 * `DATABASE_URL` in `.env` points at it). A script that creates tables and demo users
 * must never run against that. Two independent checks, both of which must pass:
 *
 *   1. the target is LOCAL: `localhost`, `127.0.0.1`, `::1` or a Unix socket;
 *   2. the target is EMPTY: no tables (setup) or no users (seed).
 *
 * There is no override. A database reached through an SSH tunnel looks local; check 2
 * is what stops it, because a live database is never empty.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// A host value is local if it is empty (libpq then uses the local socket), a socket
// directory (starts with "/"), or one of the loopback names.
const isLocalHost = (host) => {
  if (host === undefined || host === null || host === "") return true;
  if (host.includes(",")) return false; // several hosts: never local
  return host.startsWith("/") || LOCAL_HOSTS.has(host.toLowerCase());
};

/**
 * What a connection string points at, without ever returning the password.
 * @returns {{ok: boolean, host: string, port: string, database: string, reason?: string}}
 */
const describeTarget = (connectionString) => {
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    return { ok: false, host: "", port: "", database: "", reason: "DATABASE_URL is empty" };
  }
  // `postgresql://user@/db` (no host) is how a local socket is written; Node's URL parser
  // rejects it. An empty host means the local socket to PostgreSQL, so say so: `localhost`.
  const readable = connectionString.replace(
    /^(postgres(?:ql)?:\/\/(?:[^@/]*@)?)\/(?!\/)/,
    "$1localhost/",
  );
  let url;
  try {
    url = new URL(readable);
  } catch {
    return { ok: false, host: "", port: "", database: "", reason: "DATABASE_URL cannot be read" };
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    return { ok: false, host: "", port: "", database: "", reason: "DATABASE_URL is not a PostgreSQL address" };
  }
  // libpq lets ?host= and ?hostaddr= override the host part: look at all three.
  const queryHost = url.searchParams.get("host");
  const hostAddr = url.searchParams.get("hostaddr");
  const host = queryHost ?? url.hostname;
  const local = isLocalHost(host) && isLocalHost(hostAddr);
  return {
    ok: local,
    host: host === "" ? "(local socket)" : host,
    port: url.port || url.searchParams.get("port") || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    reason: local ? undefined : `the host "${host}" is not local`,
  };
};

const isLocalTarget = (connectionString) => describeTarget(connectionString).ok;

/** Throws unless the connection string points at a local database. */
const assertLocalTarget = (connectionString) => {
  const target = describeTarget(connectionString);
  if (!target.ok) {
    throw new Error(
      `Refusing to run: ${target.reason}. The demo setup only writes to a LOCAL database ` +
        "(localhost, 127.0.0.1, ::1 or a Unix socket). Point DATABASE_URL at a local, empty database.",
    );
  }
  return target;
};

/** Throws if the database already has tables (setup) – it must start empty. */
const assertNoTables = async (client) => {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
  );
  if (rows[0].n !== 0) {
    throw new Error(
      `Refusing to run: the database already has ${rows[0].n} tables. db:setup only works on an empty database.`,
    );
  }
};

/** Throws unless the users table exists and is empty (seed). */
const assertNoUsers = async (client) => {
  const exists = await client.query("SELECT to_regclass('public.users') AS t");
  if (!exists.rows[0].t) {
    throw new Error("Refusing to run: there is no users table. Run `npm run db:setup` first.");
  }
  const { rows } = await client.query("SELECT count(*)::int AS n FROM users");
  if (rows[0].n !== 0) {
    throw new Error(
      `Refusing to run: the database already has ${rows[0].n} users. seed:demo only works on a database without users.`,
    );
  }
};

module.exports = { describeTarget, isLocalTarget, assertLocalTarget, assertNoTables, assertNoUsers };
