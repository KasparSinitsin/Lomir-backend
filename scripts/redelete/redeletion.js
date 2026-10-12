// The logic of scripts/redelete-after-restore.js (STATUS item 59): read the
// deletion records mailed to the operator inbox, decide for each one what a
// restored database needs, and make the deletion again.
//
// Database access is passed in, so the decisions can be tested without one.

// A line of the records file may carry other text around the JSON (a pasted
// mail); the JSON object on it is the record. A line with a "{" is always
// read as a record, so one cut off while pasting is REPORTED, not skipped.
const extractJson = (line) => {
  const start = line.indexOf("{");
  if (start === -1) return null;
  const end = line.lastIndexOf("}");
  return end > start ? line.slice(start, end + 1) : line.slice(start);
};

const isIsoTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

/**
 * Parses the records file. Lines without a `{` are ignored (empty lines, mail
 * headers). Returns the valid records, newest record per kind+id, oldest
 * deletion first, and the problems found, by line number.
 */
const parseRecords = (text) => {
  const problems = [];
  const byKey = new Map();

  String(text)
    .split(/\r?\n/)
    .forEach((line, index) => {
      const json = extractJson(line);
      if (!json) return;
      const lineNo = index + 1;

      let record;
      try {
        record = JSON.parse(json);
      } catch {
        problems.push(`line ${lineNo}: not valid JSON`);
        return;
      }

      if (record?.v !== 1) return void problems.push(`line ${lineNo}: unknown record version`);
      if (record.kind !== "account" && record.kind !== "team") {
        return void problems.push(`line ${lineNo}: unknown kind`);
      }
      if (!Number.isInteger(record.id) || record.id <= 0) {
        return void problems.push(`line ${lineNo}: no valid id`);
      }
      if (!isIsoTime(record.deletedAt)) return void problems.push(`line ${lineNo}: no deletion time`);

      const key = `${record.kind}:${record.id}`;
      const known = byKey.get(key);
      if (!known || Date.parse(known.deletedAt) < Date.parse(record.deletedAt)) {
        byKey.set(key, record);
      }
    });

  const records = [...byKey.values()].sort(
    (a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt),
  );
  return { records, problems };
};

const sameInstant = (a, b) =>
  a !== null && a !== undefined && b !== null && b !== undefined &&
  new Date(a).getTime() === new Date(b).getTime();

// What the restored database holds under this id: gone, the same row, or a
// different row that only shares the id (the id was handed out again).
const matchRow = (row, recordedCreatedAt) => {
  if (!row) return "gone";
  if (!recordedCreatedAt) return "unverifiable";
  return sameInstant(row.created_at, recordedCreatedAt) ? "same" : "other";
};

/**
 * Decides what to do with one record against the restored database.
 *
 * @returns {Promise<object>} a plan: { action, reason, ... }
 *   action: "delete-account" | "delete-team" | "skip" | "refuse"
 */
const planRecord = async (queryable, record, { acceptedHosts }) => {
  if (!acceptedHosts.has(record.db)) {
    return { record, action: "skip", reason: `other database (${record.db || "unknown"})` };
  }

  if (record.kind === "team") {
    const { rows } = await queryable.query("SELECT id, created_at FROM teams WHERE id = $1", [record.id]);
    const match = matchRow(rows[0], record.createdAt);
    if (match === "gone") return { record, action: "skip", reason: "already gone" };
    if (match !== "same") {
      return { record, action: "refuse", reason: "the id now belongs to another team (creation time differs or is missing)" };
    }
    return { record, action: "delete-team" };
  }

  const { rows } = await queryable.query("SELECT id, created_at FROM users WHERE id = $1", [record.id]);
  const match = matchRow(rows[0], record.createdAt);
  if (match === "gone") {
    return { record, action: "skip", reason: "already gone" };
  }
  if (match !== "same") {
    return { record, action: "refuse", reason: "the id now belongs to another account (creation time differs or is missing)" };
  }

  // A recorded successor is used only where the restored database still lets
  // the deletion accept it: the person still owns the team, and the successor
  // is still an admin or member there. Otherwise the default successor applies.
  const overrides = [];
  let droppedSuccessors = 0;
  for (const { team, user } of record.successors || []) {
    const { rows: ok } = await queryable.query(
      `SELECT
         EXISTS (SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 AND role = 'owner')
         AND EXISTS (SELECT 1 FROM team_members WHERE team_id = $1 AND user_id <> $2)
         AND EXISTS (SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $3 AND role IN ('admin', 'member'))
         AS usable`,
      [team, record.id, user],
    );
    if (ok[0]?.usable) overrides.push({ team_id: team, successor_id: user });
    else droppedSuccessors += 1;
  }

  return { record, action: "delete-account", overrides, droppedSuccessors, teams: await planTeams(queryable, record) };
};

// The solo teams recorded with an account: they were deleted then, so they go
// again, unless their id now belongs to another team.
const planTeams = async (queryable, record) => {
  const plans = [];
  for (const team of record.teams || []) {
    const { rows } = await queryable.query("SELECT id, created_at FROM teams WHERE id = $1", [team.id]);
    plans.push({ id: team.id, match: matchRow(rows[0], team.createdAt) });
  }
  return plans;
};

const responseCollector = () => ({
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

/**
 * Carries out one plan. Each deletion runs in its own transaction (the normal
 * deletion code). Returns a list of outcome lines: ids and words, no names.
 */
const applyPlan = async (plan, { queryable, runAccountDeletion, permanentlyDeleteTeam }) => {
  const lines = [];
  const { record } = plan;

  if (plan.action === "delete-team") {
    await permanentlyDeleteTeam(record.id);
    lines.push(`team ${record.id}: deleted`);
    return lines;
  }

  if (plan.action === "delete-account") {
    const res = responseCollector();
    await runAccountDeletion(
      {
        params: { id: String(record.id) },
        user: { id: record.id },
        body: { ownership_overrides: plan.overrides },
        app: { get: () => null },
      },
      res,
      { skipPasswordCheck: true },
    );
    if (res.statusCode !== 200) {
      lines.push(`account ${record.id}: FAILED (${res.statusCode} ${res.body?.message || ""})`.trim());
      return lines;
    }
    lines.push(`account ${record.id}: deleted`);
  }

  // Recorded solo teams, after the account (whose deletion may already have removed them).
  for (const team of plan.teams || []) {
    if (team.match === "same") {
      const { rows } = await queryable.query("SELECT 1 FROM teams WHERE id = $1", [team.id]);
      if (rows.length === 0) {
        lines.push(`  team ${team.id} (deleted with the account): already gone with it`);
        continue;
      }
      try {
        await permanentlyDeleteTeam(team.id);
        lines.push(`  team ${team.id} (deleted with the account): deleted`);
      } catch (error) {
        lines.push(`  team ${team.id} (deleted with the account): FAILED (${error?.message || error})`);
      }
    } else if (team.match !== "gone") {
      lines.push(`  team ${team.id} (deleted with the account): REFUSED, the id now belongs to another team`);
    }
  }
  return lines;
};

module.exports = { parseRecords, planRecord, applyPlan, matchRow };
