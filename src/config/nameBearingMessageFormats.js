/**
 * Every stored `messages.content` format that embeds a person's display name.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Account deletion has to remove names that were written into message text,
 * not just rows that reference a user by id. `deleteUser` did that from a
 * hand-maintained emoji allow-list, which had already rotted once (BE #344:
 * the list held eight prefixes while role events were writing four others).
 * An allow-list kept beside the writers, rather than derived from them, is the
 * same defect as the one it is meant to guard against.
 *
 * This table is the single place that records, per format: who writes it, how
 * the row is stored, whose name ends up in the content, and whether that person
 * is the row's `sender_id`. The scrub derives its matching from here.
 *
 * HOW A DELETED USER'S NAME IS REMOVED TODAY (two mechanisms, not one)
 * -------------------------------------------------------------------
 * 1. Direct messages are deleted outright, before any scrub runs:
 *      DELETE FROM messages WHERE (sender_id = $1 OR receiver_id = $1)
 *        AND team_id IS NULL
 *    Every DM format below names exactly its two parties, so the row that holds
 *    the name is gone. `storage: "dm"` entries are therefore covered by the
 *    delete, NOT by the scrub — which is why their prefixes are absent from the
 *    scrub list and why adding them there would change nothing.
 *    ⚠️ Verified by reading every write site on 2026-09-30, not against data.
 *    A DM naming a THIRD party would escape both mechanisms; none does today,
 *    and `namedIsSender`/`namedParties` below is what a new format must state
 *    so this stays checkable.
 *
 * 2. Team messages survive the delete (`team_id IS NOT NULL`) and are scrubbed
 *    in place, replacing the name with the tombstone display name.
 *
 * THE GAP THIS TABLE MAKES VISIBLE
 * --------------------------------
 * 🔴 The scrub also requires `sender_id = $1`, and five live team formats name
 * someone who is NOT the sender (`namedIsSender: false` below). For those, the
 * name stays after deletion. The emoji list is not what fails there — four of
 * the five prefixes are already listed. One condition is.
 *
 * 🔴 One of those five is written with `sender_id = NULL`, by `deleteUser`
 * itself (`senderCanBeNull` below, derived as
 * `FORMATS_WITH_NULL_SENDER`). No sender-based condition can EVER reach a NULL,
 * so that row is not a tuning problem — it rules the whole `sender_id` approach
 * out rather than narrowing it. Deleting an account that owns a team creates
 * one such row, naming the successor.
 * Full audit: `lomir-docs-internal/HANDOVER-Privacy-Security-Hardening.md`.
 *
 * ⚠️ Compare code points, not glyphs. `✏️` is U+270F U+FE0F and `🗑️` is
 * U+1F5D1 U+FE0F. A prefix written without the variation selector looks
 * identical in every editor and makes a SQL `LIKE` match nothing, silently.
 * `test/userDeletion.namePrefixes.test.js` asserts these against the writers.
 */

/**
 * `marker`        the uppercase token after the emoji, or `null` for the older
 *                 prose formats that have no machine-readable marker.
 * `emoji`         the exact prefix as the writer emits it, variation selectors
 *                 included.
 * `storage`       `"team"` (team_id set) or `"dm"` (receiver_id set, team_id
 *                 NULL). Decides which of the two mechanisms above applies.
 * `namedIsSender` true when every name in the content belongs to the row's
 *                 `sender_id`. `false` means the scrub's `sender_id = $1`
 *                 condition cannot reach it.
 * `writtenBy`     the write site, so the next audit does not start from grep.
 * `live`          false for formats no longer written; old rows still exist, so
 *                 the scrub must keep matching them.
 */
const NAME_BEARING_MESSAGE_FORMATS = [
  // --- Role events. `vacantRoleController.ROLE_EVENT_MESSAGE_TYPES` is the
  // --- writer's own table; the test cross-checks this list against it.
  {
    marker: "ROLE_CREATED",
    emoji: "🆕",
    storage: "team",
    namedIsSender: true,
    writtenBy: "vacantRoleController.buildRoleEventMessage",
    live: true,
  },
  {
    marker: "ROLE_UPDATED",
    emoji: "✏️",
    storage: "team",
    namedIsSender: true,
    writtenBy: "vacantRoleController.buildRoleEventMessage",
    live: true,
  },
  {
    marker: "ROLE_DELETED",
    emoji: "🗑️",
    storage: "team",
    namedIsSender: true,
    writtenBy: "vacantRoleController.buildRoleEventMessage",
    live: true,
  },
  {
    marker: "ROLE_CLOSED",
    emoji: "🔒",
    storage: "team",
    namedIsSender: true,
    writtenBy: "vacantRoleController.buildRoleEventMessage",
    live: true,
  },
  {
    marker: "ROLE_REOPENED",
    emoji: "🔓",
    storage: "team",
    namedIsSender: true,
    writtenBy: "vacantRoleController.buildRoleEventMessage",
    live: true,
  },
  {
    marker: "ROLE_REOPENED_ADMIN",
    emoji: "🔓",
    storage: "team",
    namedIsSender: true,
    writtenBy: "vacantRoleController.buildRoleEventMessage",
    live: true,
  },
  {
    // 🔴 Names `filledUserId:filledUserName` alongside the actor. When the
    // filled user is not the one who filled the role, the scrub misses them.
    marker: "ROLE_FILLED",
    emoji: "✅",
    storage: "team",
    namedIsSender: false,
    writtenBy: "vacantRoleController.buildRoleEventMessage (role_filled branch)",
    live: true,
  },

  // --- Team messages written outside the role-event table.
  {
    marker: "ROLE_INVITATION_FILLED",
    emoji: "✅",
    storage: "team",
    namedIsSender: true,
    writtenBy: "invitationController.buildRoleInvitationFilledMessage",
    live: true,
  },
  {
    // 🔴 Team message whose sender is the approver, naming the applicant too.
    marker: "ROLE_APPLICATION_DEFERRED_INVITE",
    emoji: "📬",
    storage: "team",
    namedIsSender: false,
    writtenBy: "teamApplicationsController.buildRoleApplicationDeferredInviteMessage",
    live: true,
  },
  {
    // 🔴 Names ONLY the removed member; the sender is the admin who removed
    // them. Its 🚫 sibling below is a DM, which is why lumping all 🚫 formats
    // together as "DMs, therefore unreachable" was wrong for this one.
    marker: "MEMBER_REMOVED_PUBLIC",
    emoji: "🚫",
    storage: "team",
    namedIsSender: false,
    writtenBy: "teamMembersController (removeMember, both branches)",
    live: true,
  },
  {
    marker: "MEMBER_LEFT",
    emoji: "🚪",
    storage: "team",
    namedIsSender: true,
    writtenBy: "teamMembersController (self-removal branch)",
    live: true,
  },

  // --- Prose formats with no marker. Still written, still name people.
  {
    // 🔴 Sender is the invitee who accepted, and the name is theirs — covered.
    marker: null,
    emoji: "👋",
    storage: "team",
    namedIsSender: true,
    writtenBy: "invitationController (joinLine)",
    live: true,
  },
  {
    marker: null,
    emoji: "🎯",
    storage: "team",
    namedIsSender: true,
    writtenBy: "invitationController (joinLine, internal accept)",
    live: true,
  },
  {
    // 🔴 Team message whose sender is the approver; the prose names the
    // applicant as well as the approver.
    marker: null,
    emoji: "🎉",
    storage: "team",
    namedIsSender: false,
    writtenBy: "teamApplicationsController (approval system message)",
    live: true,
  },
  {
    // 🔴 Names the previous AND the new owner, with no ids at all, and the
    // sender is the previous owner. The new owner's name is unreachable.
    //
    // 🔴 It has a SECOND writer, and that one is worse: `deleteUser` itself
    // writes this format when it hands a team on to a successor, with
    // `sender_id = NULL` (see `senderCanBeNull`). So account deletion creates
    // a row naming a living person that no later deletion can scrub — not
    // because the prefix is missing (👑 is listed) but because NULL matches no
    // id. Every deletion with an ownership transfer creates one.
    marker: "OWNERSHIP_TEAM",
    emoji: "👑",
    storage: "team",
    namedIsSender: false,
    senderCanBeNull: true,
    writtenBy: [
      "teamMembersController (ownership transfer, team chat message)",
      "userDeletionController (successor tombstone, sender_id NULL)",
    ],
    live: true,
  },

  // --- Direct messages. Covered by the wholesale DM delete, not the scrub.
  {
    marker: "MEMBER_REMOVED",
    emoji: "🚫",
    storage: "dm",
    namedIsSender: false,
    writtenBy: "teamMembersController (removeMember DM)",
    live: true,
  },
  {
    marker: "APPLICATION_DECLINED",
    emoji: "🚫",
    storage: "dm",
    namedIsSender: false,
    writtenBy: "teamApplicationsController (decline DM)",
    live: true,
  },
  {
    marker: "APPLICATION_APPROVED",
    emoji: "✅",
    storage: "dm",
    namedIsSender: false,
    writtenBy: "teamApplicationsController (approval DM)",
    live: true,
  },
  {
    marker: "INVITATION_DECLINED",
    emoji: "🚫",
    storage: "dm",
    namedIsSender: false,
    writtenBy: "invitationController (decline DM)",
    live: true,
  },
  {
    marker: "INVITATION_CANCELLED",
    emoji: "🚫",
    storage: "dm",
    namedIsSender: false,
    writtenBy: "invitationController (cancel DM)",
    live: true,
  },
  {
    marker: "APPLICATION_CANCELLED",
    emoji: "🚫",
    storage: "dm",
    namedIsSender: false,
    writtenBy: "teamApplicationsController (cancel DM, one row per admin)",
    live: true,
  },
  {
    marker: "ROLE_CHANGED",
    emoji: "🔄",
    storage: "dm",
    namedIsSender: false,
    writtenBy: "teamMembersController (role change DM)",
    live: true,
  },
  {
    marker: "OWNERSHIP_TRANSFERRED",
    emoji: "👑",
    storage: "dm",
    namedIsSender: false,
    writtenBy: "teamMembersController (ownership transfer DM)",
    live: true,
  },

  // --- No longer written. Old rows remain, so the scrub still needs these.
  {
    marker: "ROLE_APPLICATION_FILLED",
    emoji: "✅",
    storage: "team",
    namedIsSender: false,
    writtenBy: null,
    live: false,
  },
  {
    marker: "ROLE_INVITATION_ACCEPTED",
    emoji: "🤝",
    storage: "team",
    namedIsSender: false,
    writtenBy: null,
    live: false,
  },
  {
    // Two prose forms share this prefix, and only ONE of them carries a
    // person's name:
    //   "📋 Application declined: [Applicant] for [Team]:"  — names the applicant
    //   "📋 Response to your invitation for [Team]:"        — team name only
    // The entry is kept for the first. The second is listed here so nobody
    // re-adds it later as a discovery; it holds no stored name, only the
    // sender's own free text.
    //
    // ⚠️ `storage` here comes from `messageSystemParser.js`, which documents
    // both as direct messages ("direct message to inviter" / "to applicant"),
    // not from a write site — neither form is written any more.
    marker: null,
    emoji: "📋",
    storage: "dm",
    namedIsSender: false,
    writtenBy: null,
    live: false,
  },
  {
    marker: null,
    emoji: "❌",
    storage: "team",
    namedIsSender: false,
    writtenBy: null,
    live: false,
  },
  {
    marker: null,
    emoji: "🚪",
    storage: "team",
    namedIsSender: true,
    writtenBy: null,
    live: false,
  },
];

/**
 * 🔴 One legacy format carries a name and has NO prefix at all:
 *   "Anna Kowalski's application for Improv Performer was approved"
 * (`messageSystemParser.js` pattern at the top of the file). A prefix match
 * cannot reach it, so it is recorded here rather than in the table above —
 * listing it with an empty prefix would make the scrub match every row.
 * Removing those names needs a different mechanism and its own decision.
 */
const UNPREFIXED_NAME_BEARING_FORMATS = [
  {
    marker: null,
    description: "<name>'s application for <role> was approved",
    storage: "team",
    live: false,
  },
];

/** The distinct emoji prefixes the scrub matches on, derived, order stable. */
const NAME_BEARING_MESSAGE_PREFIXES = [
  ...new Set(
    NAME_BEARING_MESSAGE_FORMATS.filter(
      (format) => format.storage === "team",
    ).map((format) => format.emoji),
  ),
];

/**
 * The live team formats the scrub's `sender_id = $1` condition cannot reach.
 * Kept as a derived list so the gap is countable from code rather than prose.
 */
const FORMATS_NAMING_SOMEONE_OTHER_THAN_SENDER = NAME_BEARING_MESSAGE_FORMATS.filter(
  (format) => format.storage === "team" && format.live && !format.namedIsSender,
);

/**
 * The formats whose rows can carry `sender_id = NULL`. This is the strict worst
 * case and the reason a replacement for `sender_id = $1` has to be a property of
 * the CONTENT (an anchored format prefix), not of the row's authorship: a NULL
 * sender matches no id, so no sender-based condition can reach these rows at
 * all — not a stricter one, not a looser one.
 */
const FORMATS_WITH_NULL_SENDER = NAME_BEARING_MESSAGE_FORMATS.filter(
  (format) =>
    format.storage === "team" && format.live && format.senderCanBeNull === true,
);

module.exports = {
  NAME_BEARING_MESSAGE_FORMATS,
  UNPREFIXED_NAME_BEARING_FORMATS,
  NAME_BEARING_MESSAGE_PREFIXES,
  FORMATS_NAMING_SOMEONE_OTHER_THAN_SENDER,
  FORMATS_WITH_NULL_SENDER,
};
