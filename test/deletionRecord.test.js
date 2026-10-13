// The internal deletion record (STATUS item 59): what it holds, where it goes,
// and what happens when the mail fails. No real mail: the provider is replaced.

const test = require("node:test");
const assert = require("node:assert/strict");

const mailProvider = require("../src/services/mailProvider");
const emailService = require("../src/services/emailService");
const deletionRecord = require("../src/utils/deletionRecord");

const originalSend = mailProvider.send;
const originalSendRecordEmail = emailService.sendDeletionRecordEmail;
const originalInbox = process.env.CONTACT_INBOX_EMAIL;

test.beforeEach(() => {
  mailProvider.send = async () => {
    throw new Error("real mail in a unit test");
  };
});

test.afterEach(() => {
  mailProvider.send = originalSend;
  emailService.sendDeletionRecordEmail = originalSendRecordEmail;
  if (originalInbox === undefined) delete process.env.CONTACT_INBOX_EMAIL;
  else process.env.CONTACT_INBOX_EMAIL = originalInbox;
});

const REMOTE = "ep-example-123.eu-central-1.aws.neon.tech";

test("the database host is read without user, password or query", () => {
  assert.equal(
    deletionRecord.databaseHost(`postgresql://owner:s3cret@${REMOTE}/lomir?sslmode=require`),
    REMOTE,
  );
  assert.equal(deletionRecord.databaseHost("not a url"), null);
  assert.equal(deletionRecord.isLocalDatabase("127.0.0.1"), true);
  assert.equal(deletionRecord.isLocalDatabase("localhost"), true);
  assert.equal(deletionRecord.isLocalDatabase(null), true);
  assert.equal(deletionRecord.isLocalDatabase(REMOTE), false);
});

test("an account record holds ids and timestamps only", () => {
  const record = deletionRecord.buildAccountDeletionRecord({
    userId: "7",
    createdAt: "2025-05-05T10:00:00Z",
    successors: [{ teamId: 20, successorId: "12" }],
    deletedTeams: [{ teamId: 10, teamName: "Not copied", createdAt: new Date("2025-06-06T08:00:00Z") }],
    deletedAt: new Date("2026-10-12T12:00:00Z"),
    db: REMOTE,
  });
  assert.deepEqual(record, {
    v: 1,
    kind: "account",
    id: 7,
    createdAt: "2025-05-05T10:00:00.000Z",
    deletedAt: "2026-10-12T12:00:00.000Z",
    db: REMOTE,
    successors: [{ team: 20, user: 12 }],
    teams: [{ id: 10, createdAt: "2025-06-06T08:00:00.000Z" }],
  });
});

test("a team record holds its id and timestamps; a missing creation time is null", () => {
  assert.deepEqual(
    deletionRecord.buildTeamDeletionRecord({
      teamId: 45,
      createdAt: undefined,
      deletedAt: new Date("2026-10-12T12:00:00Z"),
      db: REMOTE,
    }),
    { v: 1, kind: "team", id: 45, createdAt: null, deletedAt: "2026-10-12T12:00:00.000Z", db: REMOTE },
  );
});

test("nothing is sent for a local database", async () => {
  emailService.sendDeletionRecordEmail = async () => {
    throw new Error("must not be called");
  };
  const record = deletionRecord.buildTeamDeletionRecord({ teamId: 1, db: "127.0.0.1" });
  assert.deepEqual(await deletionRecord.sendDeletionRecord(record), {
    sent: false,
    reason: "local database",
  });
});

test("a remote database's record is mailed; a refused mail throws", async () => {
  const mailed = [];
  emailService.sendDeletionRecordEmail = async (record) => {
    mailed.push(record);
    return { success: true };
  };
  const record = deletionRecord.buildTeamDeletionRecord({ teamId: 2, db: REMOTE });
  assert.deepEqual(await deletionRecord.sendDeletionRecord(record), { sent: true });
  assert.deepEqual(mailed, [record]);

  emailService.sendDeletionRecordEmail = async () => ({ success: false });
  await assert.rejects(deletionRecord.sendDeletionRecord(record), /did not accept/);
});

test("when the mail fails, the record goes to the error log instead", async () => {
  emailService.sendDeletionRecordEmail = async () => ({ success: false });
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const record = deletionRecord.buildAccountDeletionRecord({ userId: 7, createdAt: null, db: REMOTE });
    deletionRecord.sendDeletionRecordSoon(record);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(logged.length, 1);
    assert.match(logged[0], /\[DeletionRecord\] Mail failed/);
    assert.ok(logged[0].includes(JSON.stringify(record)));
  } finally {
    console.error = originalError;
  }
});

test("the mail goes to the operator inbox with the JSON line, no reply-to", async () => {
  process.env.CONTACT_INBOX_EMAIL = "operator@example.com";
  let payload = null;
  mailProvider.send = async (sent) => {
    payload = sent;
    return { messageId: "m-1" };
  };
  const record = deletionRecord.buildAccountDeletionRecord({
    userId: 7,
    createdAt: "2025-05-05T10:00:00Z",
    successors: [{ teamId: 20, successorId: 12 }],
    deletedAt: new Date("2026-10-12T12:00:00Z"),
    db: REMOTE,
  });

  const result = await emailService.sendDeletionRecordEmail(record);

  assert.equal(result.success, true);
  assert.equal(payload.to, "operator@example.com");
  assert.equal(payload.subject, "Lomir deletion record: account 7");
  assert.equal(payload.replyTo, undefined);
  assert.ok(payload.html.includes(JSON.stringify(record).replace(/"/g, "&quot;")));
});
