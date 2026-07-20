const test = require("node:test");
const assert = require("node:assert/strict");

const invitationController = require("../src/controllers/invitationController");

const { deleteStaleInvitationNotifications } = invitationController;

test("deleteStaleInvitationNotifications clears both team and role invite notifications for the invitation", async () => {
  const calls = [];
  const queryFn = async (text, params) => {
    calls.push({ text, params });
    return { rows: [] };
  };

  await deleteStaleInvitationNotifications(queryFn, "42");

  assert.equal(calls.length, 1);
  const { text, params } = calls[0];

  assert.match(text, /DELETE FROM notifications/);
  // Both invite notification types are covered (role invites were missed before).
  assert.match(text, /type IN \('invitation_received', 'role_invitation'\)/);
  // Scoped to invitation notifications only, by invitation id.
  assert.match(text, /reference_type = 'team_invitation'/);
  assert.match(text, /reference_id = \$1/);
  // Only unread entries are removed; already-read history is kept.
  assert.match(text, /read_at IS NULL/);
  // The id is normalised to an integer for the integer column.
  assert.deepEqual(params, [42]);
});

test("deleteStaleInvitationNotifications accepts a numeric invitation id", async () => {
  const calls = [];
  const queryFn = async (text, params) => {
    calls.push({ text, params });
    return { rows: [] };
  };

  await deleteStaleInvitationNotifications(queryFn, 7);

  assert.deepEqual(calls[0].params, [7]);
});
