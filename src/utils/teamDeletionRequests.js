/**
 * What happens to a team's open applications and invitations when its owner
 * deletes it (STATUS item 40b).
 *
 * Deleting a team archives it (or removes it at once when the owner is alone),
 * and until now left every pending application and invitation hanging: nobody
 * could act on them any more, and nobody told the people who had applied or
 * been invited.
 *
 * Each of those people now gets a DM from the owner, in the shape of the
 * decline events:
 *
 *   🗑️ REQUEST_VOID: <teamId>:<team> | <ownerId>:<owner> | <kind> | <mode> | <hasPersonalMessage>
 *
 *   kind  `application` | `invitation` for someone outside the team, and
 *         `role_application` | `role_invitation` for a MEMBER who applied
 *         for, or was invited to, a role inside it
 *   mode  `archived` (scheduled for deletion) | `deleted` (removed at once)
 *
 * and, when the owner wrote one, the personal message as a SEPARATE ordinary
 * message right after it - the same way a decline carries its reply, so free
 * text never has to survive the `|`-separated event format.
 *
 * ⚠️ The recipient is deliberately NOT named in the event: they are the
 * receiver of the DM, so a name would only add a third person's name to a
 * stored row for no reader's benefit.
 *
 * A member can hold an internal role application or role invitation. They
 * are told too, in words that say it is about a role: "Your invitation can no
 * longer be considered" read wrongly to someone who is already in the team.
 * (Julia, 2026-10-09: found when Anna Lena Albers got the plain invitation
 * sentence in the demo team.)
 */

const { idNameToken } = require("./eventNameToken");
const { emitInsertedMessage } = require("./socketMessageEmitter");

const MAX_PERSONAL_MESSAGE_LENGTH = 2000;

/**
 * The people to notify and, separately, whether anything is left to close.
 * Run BEFORE the team is touched: a permanent delete takes the rows with it.
 *
 * @returns {Promise<{recipients: {kind: string, userId: number}[]}>}
 */
const collectOpenRequests = async (queryable, teamId) => {
  const result = await queryable.query(
    `SELECT CASE WHEN EXISTS (
                      SELECT 1 FROM team_members tm
                       WHERE tm.team_id = ta.team_id AND tm.user_id = ta.applicant_id
                    ) THEN 'role_application' ELSE 'application' END AS kind,
            ta.applicant_id AS user_id
       FROM team_applications ta
      WHERE ta.team_id = $1
        AND ta.status = 'pending'
     UNION ALL
     SELECT CASE WHEN EXISTS (
                      SELECT 1 FROM team_members tm
                       WHERE tm.team_id = ti.team_id AND tm.user_id = ti.invitee_id
                    ) THEN 'role_invitation' ELSE 'invitation' END AS kind,
            ti.invitee_id AS user_id
       FROM team_invitations ti
      WHERE ti.team_id = $1
        AND ti.status = 'pending'`,
    [teamId],
  );

  // One DM per person and kind, however many rows they have (an applicant can
  // hold one application per role).
  const seen = new Set();
  const recipients = [];
  for (const row of result.rows) {
    const key = `${row.kind}:${row.user_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ kind: row.kind, userId: row.user_id });
  }

  return { recipients };
};

/**
 * Closes the open requests of a team that stays in the database (archived).
 * Runs inside the archiving transaction.
 *
 * - Invitations end as `canceled`, exactly what withdrawing one does today.
 * - Applications are DELETED, exactly what withdrawing one does today - there
 *   is no "withdrawn" status, and `rejected` would read as a refusal. Drafts
 *   (never sent) go with them, and so do members' role applications: they are
 *   told they can no longer be considered, so they must not stay pending.
 */
const closeOpenRequests = async (client, teamId) => {
  await client.query(
    `UPDATE team_invitations
        SET status = 'canceled', responded_at = NOW()
      WHERE team_id = $1 AND status = 'pending'`,
    [teamId],
  );
  await client.query(
    `DELETE FROM team_applications
      WHERE team_id = $1 AND status IN ('pending', 'draft')`,
    [teamId],
  );
};

const buildRequestVoidMessage = ({
  teamId,
  teamName,
  ownerId,
  ownerName,
  kind,
  mode,
  hasPersonalMessage,
}) =>
  `🗑️ REQUEST_VOID: ${idNameToken(teamId, teamName)} | ${idNameToken(ownerId, ownerName)} | ${kind} | ${mode} | ${hasPersonalMessage ? "true" : "false"}`;

/**
 * Sends the DMs. Never throws: the team is already archived or gone, and a
 * failed courtesy message must not turn that into an error for the owner.
 */
const sendRequestVoidMessages = async ({
  req,
  queryable,
  team,
  owner,
  recipients,
  mode,
  personalMessage,
}) => {
  const personal =
    typeof personalMessage === "string" ? personalMessage.trim() : "";

  for (const recipient of recipients) {
    try {
      const eventResult = await queryable.query(
        `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, sender_id, receiver_id, content, sent_at`,
        [
          owner.id,
          recipient.userId,
          buildRequestVoidMessage({
            teamId: team.id,
            teamName: team.name,
            ownerId: owner.id,
            ownerName: owner.name,
            kind: recipient.kind,
            mode,
            hasPersonalMessage: Boolean(personal),
          }),
        ],
      );
      await emitInsertedMessage(req, eventResult.rows[0]);

      if (personal) {
        const personalResult = await queryable.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, sender_id, receiver_id, content, sent_at`,
          [owner.id, recipient.userId, personal],
        );
        await emitInsertedMessage(req, personalResult.rows[0]);
      }
    } catch (error) {
      console.error(
        `Error notifying user ${recipient.userId} about the deleted team ${team.id}:`,
        error,
      );
    }
  }
};

module.exports = {
  MAX_PERSONAL_MESSAGE_LENGTH,
  collectOpenRequests,
  closeOpenRequests,
  buildRequestVoidMessage,
  sendRequestVoidMessages,
};
