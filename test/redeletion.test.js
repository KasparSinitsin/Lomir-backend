// The re-deletion after a backup restore (STATUS item 59): reading the records,
// deciding per record, carrying it out. No database: a fake answers the
// queries. The real run on a restored throwaway database:
// deletion-audit/fixtures/88-redelete-after-restore-verify.cjs.

const test = require("node:test");
const assert = require("node:assert/strict");

const { parseRecords, planRecord, applyPlan } = require("../scripts/redelete/redeletion");

const DB = "ep-example-123.eu-central-1.aws.neon.tech";
const accepted = { acceptedHosts: new Set([DB]) };
const line = (record) => JSON.stringify({ v: 1, db: DB, ...record });

test("records are read from pasted mail text; bad lines are reported by number", () => {
  const text = [
    "Subject: Lomir deletion record: account 7",
    `some text before ${line({ kind: "account", id: 7, createdAt: "2025-01-01T00:00:00.000Z", deletedAt: "2026-10-12T10:00:00.000Z" })} and after`,
    "",
    line({ kind: "team", id: 3, createdAt: null, deletedAt: "2026-10-11T10:00:00.000Z" }),
    "{ not json }",
    JSON.stringify({ v: 2, kind: "team", id: 4, deletedAt: "2026-10-11T10:00:00.000Z" }),
    line({ kind: "user", id: 5, deletedAt: "2026-10-11T10:00:00.000Z" }),
    line({ kind: "team", id: 0, deletedAt: "2026-10-11T10:00:00.000Z" }),
    line({ kind: "team", id: 6 }),
    line({ kind: "account", id: 8, createdAt: "2025-01-01T00:00:00.000Z", deletedAt: "2026-10-12T10:00:00.000Z" }).slice(0, 40),
  ].join("\n");

  const { records, problems } = parseRecords(text);
  assert.deepEqual(records.map((r) => `${r.kind}:${r.id}`), ["team:3", "account:7"], "oldest deletion first");
  assert.deepEqual(problems, [
    "line 5: not valid JSON",
    "line 6: unknown record version",
    "line 7: unknown kind",
    "line 8: no valid id",
    "line 9: no deletion time",
    "line 10: not valid JSON",
  ]);
});

test("the same record twice counts once, the later one wins", () => {
  const { records } = parseRecords([
    line({ kind: "account", id: 7, createdAt: "2025-01-01T00:00:00.000Z", deletedAt: "2026-10-01T00:00:00.000Z" }),
    line({ kind: "account", id: 7, createdAt: "2025-01-01T00:00:00.000Z", deletedAt: "2026-10-05T00:00:00.000Z" }),
  ].join("\n"));
  assert.equal(records.length, 1);
  assert.equal(records[0].deletedAt, "2026-10-05T00:00:00.000Z");
});

// A fake database: rows per table and id, and the answer to the successor check.
const fakeDb = ({ users = {}, teams = {}, usable = () => true } = {}) => ({
  async query(sql, params) {
    if (sql.includes("FROM users WHERE id")) return { rows: users[params[0]] ? [users[params[0]]] : [] };
    if (sql.includes("FROM teams WHERE id")) return { rows: teams[params[0]] ? [teams[params[0]]] : [] };
    if (sql.includes("AS usable")) return { rows: [{ usable: usable(params[0], params[2]) }] };
    throw new Error(`unexpected query: ${sql}`);
  },
});

const account = (extra = {}) => ({
  v: 1, kind: "account", id: 7, db: DB,
  createdAt: "2025-01-01T00:00:00.000Z", deletedAt: "2026-10-12T10:00:00.000Z",
  successors: [], teams: [], ...extra,
});

test("a record of another database is skipped", async () => {
  const plan = await planRecord(fakeDb(), account({ db: "other.example" }), accepted);
  assert.equal(plan.action, "skip");
  assert.match(plan.reason, /other database/);
});

test("an account that is already gone is skipped", async () => {
  const plan = await planRecord(fakeDb(), account(), accepted);
  assert.deepEqual([plan.action, plan.reason], ["skip", "already gone"]);
});

test("an id that now belongs to another account is refused, as is a record without a creation time", async () => {
  const db = fakeDb({ users: { 7: { id: 7, created_at: new Date("2026-10-13T09:00:00Z") } } });
  assert.equal((await planRecord(db, account(), accepted)).action, "refuse");
  assert.equal((await planRecord(db, account({ createdAt: null }), accepted)).action, "refuse");
});

test("the same account is deleted again; a recorded successor is kept only where still possible", async () => {
  const db = fakeDb({
    users: { 7: { id: 7, created_at: new Date("2025-01-01T00:00:00Z") } },
    teams: { 30: { id: 30, created_at: new Date("2025-02-02T00:00:00Z") } },
    usable: (team) => team === 20,
  });
  const plan = await planRecord(
    db,
    account({
      successors: [{ team: 20, user: 12 }, { team: 21, user: 13 }],
      teams: [{ id: 30, createdAt: "2025-02-02T00:00:00.000Z" }, { id: 31, createdAt: "2025-03-03T00:00:00.000Z" }],
    }),
    accepted,
  );
  assert.equal(plan.action, "delete-account");
  assert.deepEqual(plan.overrides, [{ team_id: 20, successor_id: 12 }]);
  assert.equal(plan.droppedSuccessors, 1);
  assert.deepEqual(plan.teams, [{ id: 30, match: "same" }, { id: 31, match: "gone" }]);
});

test("a team record: same team deleted, gone skipped, other team refused", async () => {
  const team = { v: 1, kind: "team", id: 5, db: DB, createdAt: "2025-04-04T00:00:00.000Z", deletedAt: "2026-10-12T00:00:00.000Z" };
  assert.equal((await planRecord(fakeDb({ teams: { 5: { id: 5, created_at: new Date("2025-04-04T00:00:00Z") } } }), team, accepted)).action, "delete-team");
  assert.equal((await planRecord(fakeDb(), team, accepted)).action, "skip");
  assert.equal((await planRecord(fakeDb({ teams: { 5: { id: 5, created_at: new Date("2026-10-13T00:00:00Z") } } }), team, accepted)).action, "refuse");
});

test("applying an account plan runs the real deletion path without the password, with the snake_case overrides", async () => {
  const calls = [];
  const lines = await applyPlan(
    {
      record: account(),
      action: "delete-account",
      overrides: [{ team_id: 20, successor_id: 12 }],
      teams: [{ id: 30, match: "same" }, { id: 31, match: "same" }, { id: 32, match: "other" }],
    },
    {
      queryable: { query: async (sql, params) => ({ rows: params[0] === 30 ? [{}] : [] }) },
      runAccountDeletion: async (req, res, options) => {
        calls.push(["account", req.params.id, req.user.id, req.body, options]);
        res.status(200).json({ success: true });
      },
      permanentlyDeleteTeam: async (id) => calls.push(["team", id]),
    },
  );
  assert.deepEqual(calls, [
    ["account", "7", 7, { ownership_overrides: [{ team_id: 20, successor_id: 12 }] }, { skipPasswordCheck: true }],
    ["team", 30],
  ]);
  assert.deepEqual(lines, [
    "account 7: deleted",
    "  team 30 (deleted with the account): deleted",
    "  team 31 (deleted with the account): already gone with it",
    "  team 32 (deleted with the account): REFUSED, the id now belongs to another team",
  ]);
});

test("a failed account deletion is reported and its teams are left alone", async () => {
  const lines = await applyPlan(
    { record: account(), action: "delete-account", overrides: [], teams: [{ id: 30, match: "same" }] },
    {
      queryable: { query: async () => ({ rows: [{}] }) },
      runAccountDeletion: async (req, res) => res.status(500).json({ message: "Error deleting user" }),
      permanentlyDeleteTeam: async () => {
        throw new Error("must not run");
      },
    },
  );
  assert.deepEqual(lines, ["account 7: FAILED (500 Error deleting user)"]);
});
