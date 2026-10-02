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
 *    Nearly every DM format names exactly its two parties, so the row holding
 *    the name is gone. `storage: "dm"` entries are therefore covered by the
 *    delete, NOT by the scrub.
 *    🔴 **But "dm" is not a guarantee, and this was claimed as one.** Until
 *    2026-10-01 the note here read "a DM naming a THIRD party would escape
 *    both mechanisms; none does today". The database says otherwise: two rows
 *    do (`DM_ROWS_NAMING_A_NON_PARTY_2026_10_01`), because their `receiver_id`
 *    is NULL, so the named person is not a party to their own message. The
 *    claim came from reading all seven write sites — which describes what the
 *    code writes TODAY, never what is already stored.
 *
 * 2. Team messages survive the delete (`team_id IS NOT NULL`) and are scrubbed
 *    in place, replacing the name with the tombstone display name.
 *
 * THE GAP THIS TABLE MAKES VISIBLE
 * --------------------------------
 * 🔴 The scrub also requires `sender_id = $1`, and several team formats name
 * someone who is NOT the sender (`namedIsSender: false`, derived as
 * `FORMATS_NAMING_SOMEONE_OTHER_THAN_SENDER`). For those the name stays after
 * deletion. **The emoji list is not what fails there** — most of those
 * prefixes are already listed. One condition is.
 *
 * 🔴 Some of those rows carry `sender_id = NULL` (`FORMATS_WITH_NULL_SENDER`),
 * and `deleteUser` creates one itself every time it hands a team to a
 * successor. No sender-based condition can EVER reach a NULL, so this is not a
 * tuning problem — it rules the whole `sender_id` approach out rather than
 * narrowing it. **The replacement has to match on CONTENT, not authorship.**
 *
 * ⚠️ HOW THIS TABLE HAS BEEN WRONG, THREE TIMES, SO THE PATTERN IS VISIBLE
 * Every single error came from reading code and inferring data:
 *   - an emoji allow-list maintained beside its writers rotted (BE #344);
 *   - "16 of 26 formats leak" ignored a delete that runs before the scrub, and
 *     "the DM formats are safe" was right for the wrong reason (BE #345);
 *   - and then the census of 2026-10-01 falsified four more fields, including
 *     one format missing from the table entirely and one marked "legacy, no
 *     write site" with 48 live rows.
 * **Read the data before changing anything here.** Queries: the privacy
 * handover. Full audit: `lomir-docs-internal/HANDOVER-Privacy-Security-Hardening.md`.
 *
 * ⚠️ Compare code points, not glyphs. `✏️` is U+270F U+FE0F and `🗑️` is
 * U+1F5D1 U+FE0F. A prefix written without the variation selector looks
 * identical in every editor and makes a SQL `LIKE` match nothing, silently.
 * `test/userDeletion.namePrefixes.test.js` asserts these against the writers.
 */

/**
 * `marker`         the uppercase token after the emoji, or `null` for the older
 *                  prose formats that have no machine-readable marker.
 * `emoji`          the exact prefix as the writer emits it, variation selectors
 *                  included.
 * `storage`        `"team"` (team_id set) or `"dm"` (receiver_id set, team_id
 *                  NULL). Decides which of the two mechanisms above applies.
 * `legacyStorage`  set when rows of the OTHER storage kind exist from a write
 *                  path that no longer runs. 🔴 Two formats have this, and both
 *                  were missed by reading code alone — see the census below.
 * `namedIsSender`  true when, **in every stored row**, every name in the
 *                  content belongs to that row's `sender_id`. `false` means
 *                  the scrub's `sender_id = $1` condition cannot reach some
 *                  rows.
 *                  ⚠️ **About rows, not about the writer's intent** — and that
 *                  distinction is a correction, not pedantry. `👋` was set
 *                  `true` because its writer makes the invitee both sender and
 *                  subject; 5 of its 136 rows then turned out to have no
 *                  sender at all. One writer behaving well does not make the
 *                  field true. **When several writers disagree, or when the
 *                  data is unknown, set `false`** — the pessimistic value
 *                  costs a redundant prefix, the optimistic one costs a name.
 * `senderCanBeNull` rows exist with `sender_id = NULL`. Strictly worse than
 *                  `namedIsSender: false`: no sender condition reaches a NULL.
 * `writtenIn`      🔴 `"frontend"` or `"both"`; **omitted means backend-only**,
 *                  which is the common case. **The frontend
 *                  writes some of these formats through the ordinary
 *                  send-message API** (`utils/roleEventMessages.js`), so this
 *                  file is NOT a map of backend write sites. Searching only
 *                  this repo is what hid `ROLE_APPLICATION_FILLED` for a whole
 *                  audit round — `git log -S` found nothing because the string
 *                  has never existed in this repo.
 * `writtenBy`      the write site(s), so the next audit does not start from
 *                  grep. A string, or an array when there are several.
 * `carriesPersonName` set to false once a format has been checked and found to
 *                  embed no person's name at all. Such a format stays listed —
 *                  deleting the entry invites the next audit to rediscover it
 *                  as a mystery — but it is excluded from the gap derivations.
 *                  ⚠️ Only set it from evidence, and say in the comment what
 *                  was observed and what was inferred.
 * `knownRowIds`    for a format whose affected rows are few and enumerated,
 *                  the actual `messages.id` values, measured on the date in
 *                  the entry's comment. ⚠️ A convenience for the eventual
 *                  migration, **not** a definition: new rows are not added
 *                  here automatically, so re-measure rather than trusting it
 *                  as complete.
 * `live`           whether a writer still EXISTS IN CODE. ⚠️ Not the same as
 *                  "rows are still arriving" — `OBSERVED_ROWS_2026_10_01`
 *                  below is the data side, and the two disagree for several
 *                  formats. Rows persist either way, so the scrub must keep
 *                  matching legacy formats.
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
    // 🔴 TWO writers that disagree about whose name goes in, found 2026-10-01.
    // The backend names the actor, who IS the sender. The frontend names the
    // person VACATING the role, who is not — an admin reopening someone
    // else's role writes their name into a row the admin sent. So the format
    // as stored can go either way, and the pessimistic value is the safe one.
    // 101 team rows exist; the split between the two writers is not known.
    marker: "ROLE_REOPENED",
    emoji: "🔓",
    storage: "team",
    namedIsSender: false,
    writtenIn: "both",
    writtenBy: [
      "vacantRoleController.buildRoleEventMessage (names the actor = sender)",
      "teamMembersController.js:36 buildRoleReopenedLeaveMessage, inserted " +
        ":442 with sender_id = memberId (names the member = sender)",
      "FRONTEND services/teamMemberRoleReopenService.js:87 via " +
        "messageService.sendMessage (names the vacating user, NOT the sender)",
    ],
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
    // 🔴 `senderCanBeNull` added 2026-10-02 from the anchored scrub's dry run
    // (`deletion-audit/10`, section B): 1 of the 68 team rows has no sender.
    // That is the FIFTH field in this table the data has falsified, and the
    // same way every time — the entry described the writer, and the writer
    // always supplies a sender.
    //
    // 🟢 It costs nothing here, and the reason is worth keeping: this format
    // carries an id token (`🚪 MEMBER_LEFT:<id>:<name>`), so the scrub reaches
    // it through the id-anchored statement, which has no sender condition at
    // all. Before that statement existed, this row would have leaked silently.
    // ⚠️ Not an argument that NULL senders stopped mattering: a format with no
    // id token and no sender is still unreachable, which is why
    // `👑 OWNERSHIP_TEAM` needed its own delimited statement.
    // ⚠️ `namedIsSender` is therefore FALSE, by the same rule the `👋` entry
    // spells out: in a row with no sender the named person is not the sender,
    // because nobody is. The writer's intent does not get a vote on a field
    // that describes stored rows. This moves the format into
    // `FORMATS_NAMING_SOMEONE_OTHER_THAN_SENDER`, which is about naming and not
    // about reachability — it is reached, by the id-anchored statement.
    marker: "MEMBER_LEFT",
    emoji: "🚪",
    storage: "team",
    namedIsSender: false,
    senderCanBeNull: true,
    nullSenderSource: "unknown — 1 of 68 team rows, dry run 2026-10-02",
    writtenBy: "teamMembersController (self-removal branch)",
    live: true,
  },

  // --- Prose formats with no marker. Still written, still name people.
  // --- 🔴 These are the hardest group, and the census is why. A prefix match
  // --- on a bare emoji cannot distinguish them from things people type:
  // --- the 2026-10-01 census found users opening messages with 👍 (56 rows),
  // --- ❤️ (14), 🙏 (17), 😎, 🎉✨, 🔥😎 — and TWO distinct `👋` prefix groups,
  // --- one of which is very likely user text. An anchored `emoji + MARKER:`
  // --- rule is safe; for these there is no marker to anchor on. Any fix for
  // --- this group needs its own mechanism, not a wider prefix list.
  {
    // The writer makes the invitee both the sender and the named person, so
    // the scrub reaches the ordinary rows.
    // 🔴 `namedIsSender` is nevertheless FALSE, and the reason is the whole
    // lesson of this field: **5 of the 136 team rows carry
    // `sender_id = NULL`** (census 2026-10-01). In those rows the named person
    // is not the sender, because nobody is. A field describing stored rows
    // cannot be set from what the writer intends. The write path that produced
    // a null-sender join line is not known.
    marker: null,
    emoji: "👋",
    storage: "team",
    namedIsSender: false,
    senderCanBeNull: true,
    nullSenderSource: "unknown — 5 of 136 rows, census 2026-10-01",
    writtenBy: "invitationController.js:1138 (joinLine)",
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
    //
    // ✅ SEEN IN THE RUNNING APP, 2026-10-01, which is why this entry is not a
    // code-reading claim: team 129, message **5942**, renders as
    //   "Ein ehemaliger Lomir-Nutzer hat das Team-Eigentum an <successor>
    //    übertragen."
    // The deleted person is anonymised correctly and the successor is named in
    // full, in a row with no sender. Message **5929** in the same chat shows
    // the ordinary variant: the previous owner is the sender and the NEW owner
    // is named, so the new owner's name is equally unreachable.
    // ⚠️ Worth keeping because it is the only leak in this table that was
    // predicted from code and then photographed — the rest is still inference
    // from write sites plus the row census.
    marker: "OWNERSHIP_TEAM",
    emoji: "👑",
    storage: "team",
    namedIsSender: false,
    senderCanBeNull: true,
    nullSenderSource:
      "userDeletionController successor tombstone, inserted with sender_id NULL",
    writtenBy: [
      "teamMembersController (ownership transfer, team chat message)",
      "userDeletionController (successor tombstone, sender_id NULL)",
    ],
    live: true,
  },

  // --- Direct messages. Covered by the wholesale DM delete, not the scrub.
  {
    // 🔴 `legacyStorage` found 2026-10-01, and ONLY in the data. Both current
    // write sites insert DMs, so code reading says "DM, therefore covered by
    // the wholesale delete". The census found **6 team rows, all dated
    // 2026-01-14**, from a write path that no longer exists. They are team
    // messages naming the removed member with the admin as sender, so they
    // leak — and no amount of reading today's code would have shown them.
    marker: "MEMBER_REMOVED",
    emoji: "🚫",
    storage: "dm",
    legacyStorage: "team",
    namedIsSender: false,
    writtenBy: [
      "teamMembersController.js:415 (removeMember DM)",
      "teamMembersController.js:737 (removeMember DM, second path)",
    ],
    live: true,
  },
  {
    // 🔴 Missing from this table entirely until 2026-10-01, and the reason is
    // the method: the table was built from the `// Format:` comments in the
    // frontend's `messageSystemParser.js`, and this format has no such
    // comment. The census found it because the census did not ask the parser.
    //
    // 🟢 It does NOT leak: the named person is the owner deleting the team,
    // who is also the sender, and `🗑️` is already in the prefix list — shared
    // with ROLE_DELETED. Covered by coincidence rather than by design, which
    // is worth knowing if anyone ever narrows the prefixes.
    marker: "TEAM_DELETED",
    emoji: "🗑️",
    storage: "team",
    legacyStorage: "dm", // 29 DM rows from an older path; 2 team rows
    namedIsSender: true,
    writtenBy: "teamController.js:858 (team chat message)",
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

  // --- Written by the FRONTEND, through the ordinary send-message API.
  // --- 🔴 This whole group was recorded as "no write site, legacy" until
  // --- 2026-10-01, because the search only ever covered this repo.
  {
    // 🔴 The correction that exposed the frontend writer. This entry said
    // `live: false, writtenBy: null` while **48 team rows existed, the newest
    // from 2026-09-26**. `git log -S "ROLE_APPLICATION_FILLED"` over this
    // repo's entire history finds nothing, and that is correct: the string has
    // never been here. It is built in the frontend and POSTed as a normal
    // message, so `sender_id` is the approving admin while the content names
    // the APPLICANT. A live leak, and the biggest single one by row count.
    marker: "ROLE_APPLICATION_FILLED",
    emoji: "✅",
    storage: "team",
    namedIsSender: false,
    writtenIn: "frontend",
    writtenBy:
      "FRONTEND components/teams/TeamApplicationsModal.jsx:153 via " +
      "messageService.sendMessage (builder utils/roleEventMessages.js:173)",
    live: true,
  },
  {
    // Code path is live (frontend), but the census of 2026-10-01 found ZERO
    // rows — so nothing has travelled this way yet, or the rows are gone.
    // Kept listed: a live writer with no rows is one approval away from rows.
    marker: "ROLE_INVITATION_ACCEPTED",
    emoji: "🤝",
    storage: "team",
    namedIsSender: false,
    writtenIn: "frontend",
    writtenBy:
      "FRONTEND components/teams/VacantRoleDetailsModal.jsx:85 via " +
      "messageService.sendMessage",
    live: true,
  },

  // --- No longer written. Old rows remain, so the scrub still needs these.
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
  {
    // 🔴 Found in the data on 2026-10-01 and NOT traceable to any writer.
    // 6 team rows whose content starts with `🔓` but carries no marker, so
    // every marker-based census missed them — including the two the assistant
    // wrote that day, whose own output claimed to cover "every stored format".
    //
    // ⚠️ All 6 confirmed to have `sender_id = NULL`. Located 2026-10-01:
    //   id 3654  2026-04-02  team 220  Quality Assurance Practice Group  47 ch
    //   id 3655  2026-04-02  team 104  Gardening Gnomes                  57 ch
    //   id 3656  2026-04-02  team 213  Hamburg Product Design Studio     47 ch
    //   id 3708  2026-04-02  team  63  Creative Coding Experiments       50 ch
    //   id 5912  2026-07-11  team 129  Spokes & Software Collective      41 ch
    //   id 5943  2026-07-15  team 129  Spokes & Software Collective      53 ch
    // All sit within the newest 28 messages of their team chat, so the chat
    // search in the UI can reach every one of them.
    //
    // ✅ RESOLVED 2026-10-01 by looking, and the answer is no name at all.
    // The shape is the legacy prose form the frontend parser still handles at
    // `messageSystemParser.js:131`:
    //     /^🔓\s+The role (.+?) is now open again\.$/
    // It captures a ROLE and nobody else, and the German rendering picks the
    // `other` branch of `chat.event.roleReopened.full` — the branch used when
    // the format carries no user at all.
    //
    // Evidence, and note which parts are observed and which are not:
    //   OBSERVED — id 5912 renders as "Die Rolle Vacant Role ist wieder offen
    //     …", and 30 chars of frame + 11 for the role name = 41, its length.
    //   OBSERVED — id 5943 renders with role "Vacant Role edited, too";
    //     30 + 23 = 53, its length.
    //   INFERRED — the other four (47, 47, 50, 57) fit the same frame with
    //     role names of 17, 17, 20 and 27 characters. ⚠️ Not verified. The
    //     query that would close it is in the privacy handover: it checks all
    //     six against `LIKE '🔓 The role % is now open again.'` and sweeps for
    //     a second unmarked shape, printing no content.
    //
    // ⚠️ The earlier guess here was that 41–57 characters were "too long for a
    // bare role sentence" and would fit "<name> has left the role <role>".
    // That was arithmetic standing in for evidence, and it was wrong — the
    // frame is simply longer than assumed. Kept as a warning.
    //
    // 🟡 Likely seed data, which changes the PRIORITY and nothing else: four
    // of the six were written on the same day (2026-04-02), and all five teams
    // carry the DEMO badge in the UI. If the names in them are synthetic, the
    // legacy-row migration is not urgent. ⚠️ **The gap itself is unaffected** —
    // a team message with no marker, no ids and no sender is unreachable by
    // the scrub whoever is named in it, and the next such row may be real.
    marker: null,
    emoji: "🔓",
    storage: "team",
    carriesPersonName: false,
    namedIsSender: false,
    senderCanBeNull: true,
    nullSenderSource: "unknown — all 6 rows, census 2026-10-01",
    writtenBy: null,
    live: false,
    knownRowIds: [3654, 3655, 3656, 3708, 5912, 5943],
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

/**
 * Row counts measured against the production database on **2026-10-01**, by
 * printing the LITERAL prefix up to the first colon rather than matching a
 * pattern. Dated on purpose: this is evidence, not live state, and it will go
 * stale. Re-measure before quoting it — the queries are in the privacy
 * handover.
 *
 * 🔴 Why it is here at all: every field in the table above was first filled in
 * by reading code, and this census falsified four of them. A table about what
 * is IN the database deserves the data beside it.
 *
 * ⚠️ The assistant cannot run this. `pg_restore` extracts from the local dump
 * but reading the extracted rows is refused, so Julia runs it. Budget for that.
 */
const OBSERVED_ROWS_2026_10_01 = {
  "✅ APPLICATION_APPROVED:": { dm: 278, team: 0, lastSeen: "2026-10-01" },
  "✅ ROLE_APPLICATION_FILLED:": { dm: 0, team: 48, lastSeen: "2026-09-26" },
  "✅ ROLE_FILLED:": { dm: 0, team: 33, lastSeen: "2026-05-14" },
  "✅ ROLE_INVITATION_FILLED:": { dm: 0, team: 2, lastSeen: "2026-05-20" },
  "✏️ ROLE_UPDATED:": { dm: 0, team: 54, lastSeen: "2026-09-16" },
  "🆕 ROLE_CREATED:": { dm: 0, team: 72, lastSeen: "2026-10-01" },
  "👑 OWNERSHIP_TEAM:": { dm: 0, team: 38, lastSeen: "2026-09-26" },
  "👑 OWNERSHIP_TRANSFERRED:": { dm: 35, team: 0, lastSeen: "2026-09-26" },
  "📬 ROLE_APPLICATION_DEFERRED_INVITE:": { dm: 0, team: 7, lastSeen: "2026-05-19" },
  "🔄 ROLE_CHANGED:": { dm: 322, team: 0, lastSeen: "2026-10-01" },
  "🔒 ROLE_CLOSED:": { dm: 0, team: 42, lastSeen: "2026-09-29" },
  "🔓 ROLE_REOPENED:": { dm: 0, team: 101, lastSeen: "2026-10-01" },
  "🔓 ROLE_REOPENED_ADMIN:": { dm: 0, team: 4, lastSeen: "2026-05-14" },
  "🗑️ ROLE_DELETED:": { dm: 0, team: 19, lastSeen: "2026-09-17" },
  "🗑️ TEAM_DELETED:": { dm: 29, team: 2, lastSeen: "2026-09-26" },
  "🚪 MEMBER_LEFT:": { dm: 0, team: 68, lastSeen: "2026-09-30" },
  "🚫 APPLICATION_CANCELLED:": { dm: 238, team: 0, lastSeen: "2026-09-17" },
  "🚫 APPLICATION_DECLINED:": { dm: 93, team: 0, lastSeen: "2026-09-17" },
  "🚫 INVITATION_CANCELLED:": { dm: 71, team: 0, lastSeen: "2026-09-17" },
  "🚫 INVITATION_DECLINED:": { dm: 57, team: 0, lastSeen: "2026-09-16" },
  "🚫 MEMBER_REMOVED:": { dm: 56, team: 6, lastSeen: "2026-09-30" },
  "🚫 MEMBER_REMOVED_PUBLIC:": { dm: 0, team: 28, lastSeen: "2026-09-30" },
  // Prose forms, counted by leading character because they have no marker.
  "👋 (prose)": { dm: 0, team: 136, nullSender: 5, lastSeen: "2026-09-30" },
  "🚪 (prose)": { dm: 0, team: 46, nullSender: 29, lastSeen: "2026-07-15" },
  "🎯 (prose)": { dm: 0, team: 20, lastSeen: "2026-07-03" },
  "🎉 (prose)": { dm: 4, team: 21, lastSeen: "2026-04-02" },
  "🔓 (prose)": { dm: 0, team: 6, nullSender: 6, lastSeen: "2026-07-15" },
  "👑 (prose)": { dm: 0, team: 1, lastSeen: "2026-01-06" },
};

/**
 * 🔴 Two DM rows name a person who is neither sender nor receiver, because
 * their `receiver_id` is NULL (`🚫 INVITATION_CANCELLED`, ids 4179 and 5422,
 * both naming user 317; measured 2026-10-01). Most likely an older deletion
 * path nulled the receiver instead of deleting the row.
 *
 * This is the class the audit wrongly declared impossible: the wholesale DM
 * delete misses them because the named person is not a party, and the scrub
 * misses them because the row is a DM. **Neither mechanism reaches them.**
 * Small and bounded — but it is the proof that `storage: "dm"` alone is not a
 * guarantee, which is why the next migration has to sweep rows, not formats.
 */
const DM_ROWS_NAMING_A_NON_PARTY_2026_10_01 = {
  prefix: "🚫 INVITATION_CANCELLED:",
  rows: 2,
  messageIds: [4179, 5422],
  cause: "receiver_id IS NULL",
};

/**
 * The distinct emoji prefixes the scrub matches on, derived, order stable.
 *
 * ⚠️ `legacyStorage === "team"` counts too. A format written as a DM today can
 * still have team rows from a path that no longer runs — `🚫 MEMBER_REMOVED`
 * has 6 — and those rows are only reachable through the scrub. Filtering on
 * `storage` alone would have dropped them silently the moment
 * `MEMBER_REMOVED_PUBLIC` stopped sharing the prefix.
 */
const NAME_BEARING_MESSAGE_PREFIXES = [
  ...new Set(
    NAME_BEARING_MESSAGE_FORMATS.filter(
      (format) => format.storage === "team" || format.legacyStorage === "team",
    ).map((format) => format.emoji),
  ),
];

/** Team-stored, whether that is the current path or a legacy one. */
const isTeamStored = (format) =>
  format.storage === "team" || format.legacyStorage === "team";

/**
 * 🔴 The two marker formats whose content carries NO `<id>:<name>` token, only
 * bare display names — and therefore the only two the scrub cannot anonymise
 * precisely.
 *
 * Why this matters more than it looks. Every other marker format is written
 * through `formatIdNameToken` (frontend) or `${id}:${name}` (backend), so the
 * scrub can replace `<userId>:<name>` and **cannot** collide with anyone else:
 * the numeric id anchors it. These two have nothing to anchor on, so they need
 * a replacement keyed on the display name itself — which is a blind substring
 * swap, the trap recorded in the privacy handover ("Anna" also hits "Annabel").
 *
 * `personSlots` is what keeps that swap safe. Both formats are
 * `<prefix> <slot> | <slot>`, and the slots do NOT both hold people:
 *
 *   `👑 OWNERSHIP_TEAM: <previous owner> | <new owner>`  — both are persons
 *   `🗑️ TEAM_DELETED: <team name> | <owner>`             — the FIRST is a TEAM
 *
 * ⚠️ So a name replacement on a `TEAM_DELETED` row must never touch the leading
 * slot. A team name is the worse case of the same trap: "Cooking" sits inside
 * "Online Cooking & Recipe Swap Group", and a team name is far more likely to
 * be a substring of another than a person's full name is.
 *
 * ⚠️ Pinned by a test against a literal list, like the gap lists above. A NEW
 * format added to the table is assumed to carry id tokens; if it does not, the
 * scrub would miss it **silently**, so the test fails until it is listed here.
 */
const MARKER_FORMATS_WITHOUT_ID_TOKENS = [
  { marker: "OWNERSHIP_TEAM", personSlots: ["leading", "trailing"] },
  { marker: "TEAM_DELETED", personSlots: ["trailing"] },
];

const carriesIdTokens = (format) =>
  !MARKER_FORMATS_WITHOUT_ID_TOKENS.some((f) => f.marker === format.marker);

/**
 * The anchored prefixes the scrub matches on, replacing the bare-emoji list for
 * every MARKER format: `✅ ROLE_FILLED:` rather than `%✅%`.
 *
 * 🟢 The anchoring is what makes it safe to drop `sender_id = $1` for these.
 * An anchored marker prefix cannot match prose somebody typed, so widening the
 * row set cannot start editing people's words — whereas a bare emoji certainly
 * would have: the 2026-10-01 census found users opening messages with `👍` (56
 * rows), `❤️` (14), `🙏` (17), `😎`, `🎉✨`, `🔥😎`.
 *
 * 🟢 And it is complete, measured rather than assumed: `deletion-audit/07`
 * section B found **no** marker row stored without its emoji, and section C
 * none behind an alternative prefix, while section A matched all 23 recorded
 * marker counts exactly. The frontend parser accepts the emoji as optional, so
 * this had to be checked rather than reasoned about.
 */
const SCRUB_ANCHORED_PREFIXES = [
  ...new Set(
    NAME_BEARING_MESSAGE_FORMATS.filter(
      (format) =>
        isTeamStored(format) &&
        format.carriesPersonName !== false &&
        format.marker,
    ).map((format) => `${format.emoji} ${format.marker}:`),
  ),
];

/**
 * The id-less marker formats, resolved to what the scrub needs: the anchored
 * prefix and which slots hold a person.
 */
const SCRUB_ID_LESS_TARGETS = MARKER_FORMATS_WITHOUT_ID_TOKENS.map((entry) => {
  const format = NAME_BEARING_MESSAGE_FORMATS.find(
    (f) => f.marker === entry.marker,
  );

  if (!format) {
    throw new Error(
      `MARKER_FORMATS_WITHOUT_ID_TOKENS names ${entry.marker}, which is not in ` +
        `the format table — one of the two is stale`,
    );
  }

  return {
    marker: entry.marker,
    prefix: `${format.emoji} ${format.marker}:`,
    personSlots: entry.personSlots,
  };
});

/**
 * 🔴 The bare-emoji prefixes that are STILL matched the old way, with
 * `sender_id = $1`, because they have no marker to anchor on.
 *
 * ⚠️ Read this before "finishing the job" by deleting the sender condition.
 * The obvious reading of the plan was to drop `sender_id = $1` outright. That
 * would have been a REGRESSION: `🎯` and the `🚪` prose form carry
 * `namedIsSender: true`, so today they are reached precisely because the named
 * person is the sender. Anchoring cannot replace that for them — there is no
 * marker — so removing the condition would have scrubbed them never instead of
 * sometimes. The condition stays for prose and is gone for markers.
 */
const SCRUB_PROSE_EMOJI_PREFIXES = [
  ...new Set(
    NAME_BEARING_MESSAGE_FORMATS.filter(
      (format) =>
        isTeamStored(format) &&
        format.carriesPersonName !== false &&
        !format.marker,
    ).map((format) => format.emoji),
  ),
];

/**
 * The team formats the scrub's `sender_id = $1` condition cannot reach.
 * Kept as a derived list so the gap is countable from code rather than prose.
 *
 * ⚠️ Two widenings on 2026-10-01, both forced by data rather than by code:
 * `live` is no longer required (`MEMBER_REMOVED`'s 6 legacy team rows leak
 * exactly like a live format — the rows do not care that the writer is gone),
 * and `legacyStorage` counts, for the same reason.
 */
const FORMATS_NAMING_SOMEONE_OTHER_THAN_SENDER = NAME_BEARING_MESSAGE_FORMATS.filter(
  (format) =>
    isTeamStored(format) &&
    format.carriesPersonName !== false &&
    !format.namedIsSender,
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
    isTeamStored(format) &&
    format.carriesPersonName !== false &&
    format.senderCanBeNull === true,
);

/**
 * 🔴 Formats this repo does not write. Searching here finds nothing, and that
 * is exactly how `ROLE_APPLICATION_FILLED` stayed recorded as "legacy, no
 * write site" while 48 live rows existed.
 *
 * ⚠️ There is no way to guard this from one repo: the writers live in
 * `Lomir-frontend/src/utils/roleEventMessages.js`, which also holds builders
 * for six further formats that are not currently sent. If one of those gains a
 * caller, nothing here fails. That is a known structural gap, written down in
 * `HANDOVER-Privacy-Security-Hardening.md` rather than pretended away.
 */
const FORMATS_WRITTEN_BY_THE_FRONTEND = NAME_BEARING_MESSAGE_FORMATS.filter(
  (format) => format.writtenIn === "frontend" || format.writtenIn === "both",
);

/**
 * Formats checked and found to embed no person's name. They keep their place in
 * the table on purpose: an entry that was investigated and cleared is cheaper
 * than the same investigation a second time.
 */
const FORMATS_CLEARED_OF_PERSON_NAMES = NAME_BEARING_MESSAGE_FORMATS.filter(
  (format) => format.carriesPersonName === false,
);

/**
 * 🔴 What is STILL unreachable after the anchored scrub — the remaining gap,
 * kept derived so it stays countable.
 *
 * These are the team prose formats that name someone other than their sender.
 * They have no marker, so they cannot be anchored, and the sender condition
 * they are left with does not reach them because the named person is not the
 * sender. `👋` is the largest at 136 rows (5 of them with no sender at all),
 * then `🎉` at 288; `❌` has never been seen.
 *
 * ⚠️ They need their own mechanism, decided separately: an id token added to
 * the writers, or a one-off migration over known row ids. A wider prefix list
 * is NOT an option — a bare emoji match would rewrite messages people typed.
 */
const FORMATS_STILL_UNREACHABLE_AFTER_ANCHORING =
  NAME_BEARING_MESSAGE_FORMATS.filter(
    (format) =>
      isTeamStored(format) &&
      format.carriesPersonName !== false &&
      !format.marker &&
      !format.namedIsSender,
  );

module.exports = {
  NAME_BEARING_MESSAGE_FORMATS,
  FORMATS_CLEARED_OF_PERSON_NAMES,
  UNPREFIXED_NAME_BEARING_FORMATS,
  NAME_BEARING_MESSAGE_PREFIXES,
  FORMATS_NAMING_SOMEONE_OTHER_THAN_SENDER,
  FORMATS_WITH_NULL_SENDER,
  FORMATS_WRITTEN_BY_THE_FRONTEND,
  OBSERVED_ROWS_2026_10_01,
  DM_ROWS_NAMING_A_NON_PARTY_2026_10_01,
  MARKER_FORMATS_WITHOUT_ID_TOKENS,
  SCRUB_ANCHORED_PREFIXES,
  SCRUB_ID_LESS_TARGETS,
  SCRUB_PROSE_EMOJI_PREFIXES,
  FORMATS_STILL_UNREACHABLE_AFTER_ANCHORING,
  carriesIdTokens,
};
