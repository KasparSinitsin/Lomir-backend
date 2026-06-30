const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const cleanupArchivedTeams = require("../src/jobs/cleanupArchivedTeams");

const { purgeExpiredArchivedTeams } = cleanupArchivedTeams;

const originalQuery = db.query;
const originalConnect = db.pool.connect;

test.afterEach(() => {
  db.query = originalQuery;
  db.pool.connect = originalConnect;
});

test("purgeExpiredArchivedTeams permanently deletes archived teams past the grace period", async () => {
  let selectSql = "";
  db.query = async (sql) => {
    selectSql = sql;
    return { rows: [{ id: 10 }, { id: 20 }] };
  };

  // permanentlyDeleteTeam runs its own transaction through a dedicated client.
  const clientCalls = [];
  db.pool.connect = async () => ({
    async query(sql) {
      clientCalls.push(sql);
      if (sql.includes("teamavatar_url")) {
        return { rows: [{ teamavatar_url: null, teamavatar_file_id: null }] };
      }
      return { rows: [] };
    },
    release() {},
  });

  const result = await purgeExpiredArchivedTeams();

  // Only archived teams older than the grace period are selected.
  assert.match(selectSql, /archived_at IS NOT NULL/);
  assert.match(selectSql, /archived_at < NOW\(\) - INTERVAL/);

  assert.deepEqual(result, { found: 2, deleted: 2 });

  // Each selected team was hard-deleted (team row removed once per team).
  const teamDeletes = clientCalls.filter((sql) =>
    sql.includes("DELETE FROM teams WHERE id"),
  );
  assert.equal(teamDeletes.length, 2);
  // And the chat messages were purged too.
  assert.equal(
    clientCalls.filter((sql) => sql.includes("DELETE FROM messages WHERE team_id"))
      .length,
    2,
  );
});

test("purgeExpiredArchivedTeams is a no-op when nothing is past the grace period", async () => {
  db.query = async () => ({ rows: [] });

  let connectCalled = false;
  db.pool.connect = async () => {
    connectCalled = true;
    throw new Error("connect should not be called when there is nothing to purge");
  };

  const result = await purgeExpiredArchivedTeams();

  assert.deepEqual(result, { found: 0, deleted: 0 });
  assert.equal(connectCalled, false);
});

test("purgeExpiredArchivedTeams keeps going and counts only successful purges when one team fails", async () => {
  db.query = async () => ({ rows: [{ id: 10 }, { id: 20 }] });

  db.pool.connect = async () => ({
    async query(sql) {
      if (sql.includes("teamavatar_url")) {
        // Team 10 blows up while reading its avatar; team 20 succeeds.
        return { rows: [{ teamavatar_url: null, teamavatar_file_id: null }] };
      }
      return { rows: [] };
    },
    release() {},
  });

  // Make the first permanentlyDeleteTeam call fail by throwing on BEGIN once.
  let beginCount = 0;
  const originalConnectImpl = db.pool.connect;
  db.pool.connect = async () => {
    const client = await originalConnectImpl();
    const innerQuery = client.query;
    client.query = async (sql, params) => {
      if (sql === "BEGIN") {
        beginCount += 1;
        if (beginCount === 1) {
          throw new Error("simulated failure for the first team");
        }
      }
      return innerQuery(sql, params);
    };
    return client;
  };

  const result = await purgeExpiredArchivedTeams();

  assert.equal(result.found, 2);
  assert.equal(result.deleted, 1);
});
