const db = require("../../config/database");
const {
  MENTION_PLACEHOLDER,
  scrubMentionLabels,
  deleteNotificationsMentioning,
} = require("../../utils/mentionScrub");

/**
 * Gives the @-mention tokens of accounts deleted BEFORE the account deletion
 * started doing it (BE fix/deletion-completeness, STATUS item 59) the
 * placeholder label, and deletes notifications that still hold such a token.
 *
 *   @[<name>](<id of a deleted account>)  ->  @[Former Lomir User](<id>)
 *
 * The same function the account deletion now runs (utils/mentionScrub.js), for
 * each id that appears in a token and has no `users` row: structural proof of
 * deletion, never a name match. Only the label inside the token changes; the
 * rest of the message stays byte for byte. Idempotent: a label that already is
 * the placeholder is left alone, so a second run changes nothing.
 *
 * Measured (deletion-audit round 86, 2026-10-12): 4 tokens of 2 deleted
 * accounts, in 4 team messages; none in direct messages or notifications.
 * Dry run: deletion-audit/89. A data migration: it runs with the full
 * `npm run migrate` at the release, not before (never on the migrate:one list),
 * just before item 35's migration, which stays last.
 */

const EXPECTED_MESSAGES = 4;
const MAX_MESSAGES = 20;

// Ids in mention tokens (messages and notifications) without an account.
const GONE_IDS_SQL = `
  SELECT DISTINCT ref::bigint AS id
  FROM (
    SELECT (regexp_matches(m.content, '@\\[[^]]+\\]\\(([0-9]{1,18})\\)', 'g'))[1] AS ref
    FROM messages m
    WHERE m.content LIKE '%@[%'
    UNION ALL
    SELECT (regexp_matches(COALESCE(n.title, '') || ' ' || COALESCE(n.message, ''), '@\\[[^]]+\\]\\(([0-9]{1,18})\\)', 'g'))[1]
    FROM notifications n
    WHERE COALESCE(n.title, '') || COALESCE(n.message, '') LIKE '%@[%'
  ) tokens
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = tokens.ref::bigint)
  ORDER BY 1
`;

// Tokens of deleted accounts that still show something other than the placeholder.
const REMAINING_SQL = `
  SELECT count(*)::int AS remaining
  FROM messages m
  CROSS JOIN LATERAL regexp_matches(m.content, '@\\[([^]]+)\\]\\(([0-9]{1,18})\\)', 'g') AS t(parts)
  WHERE m.content LIKE '%@[%'
    AND t.parts[1] <> $1
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.parts[2]::bigint)
`;

const scrubMentionLabelsOfDeletedAccounts = async () => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: goneIds } = await client.query(GONE_IDS_SQL);
    let messages = 0;
    let notifications = 0;
    for (const { id } of goneIds) {
      messages += await scrubMentionLabels(client, id);
      notifications += await deleteNotificationsMentioning(client, id);
    }

    if (messages > MAX_MESSAGES) {
      throw new Error(
        `mention-label scrub would rewrite ${messages} messages, above the ceiling of ${MAX_MESSAGES} — rolled back.`,
      );
    }
    const { rows } = await client.query(REMAINING_SQL, [MENTION_PLACEHOLDER]);
    if (rows[0].remaining !== 0) {
      throw new Error(
        `mention-label scrub left ${rows[0].remaining} tokens of deleted accounts behind — rolled back.`,
      );
    }

    await client.query("COMMIT");
    console.log(
      `mention-label scrub: ${goneIds.length} deleted ids, ${messages} messages rewritten ` +
        `(dry run planned ${EXPECTED_MESSAGES}), ${notifications} notifications deleted, 0 left`,
    );
    if (messages !== 0 && messages !== EXPECTED_MESSAGES) {
      console.log(
        "mention-label scrub: count differs from the dry run — re-run deletion-audit/89 and read why before trusting it.",
      );
    }
    console.log(
      "mention-label scrub: VERIFY with deletion-audit/89 — to_change must now be 0. " +
        "The migration runner's success message is not evidence.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error scrubbing mention labels of deleted accounts (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = scrubMentionLabelsOfDeletedAccounts;
module.exports.GONE_IDS_SQL = GONE_IDS_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_MESSAGES = EXPECTED_MESSAGES;
module.exports.MAX_MESSAGES = MAX_MESSAGES;
