// Script to run all migrations in order
// Note: initial table-creation scripts (01–10, add_visibility_to_users,
// create_team_applications) are no longer in this repo because the base
// schema already exists in the database. Only incremental migrations live here.
const fixMessagesTimestamps = require("./fix_messages_timestamps");
const createMessageReads = require("./create_message_reads");
const addMessageEditColumns = require("./add_message_edit_columns");
const addReplyToId = require("./add_reply_to_id");
const addLegalConsentToUsers = require("./add_legal_consent_to_users");
const createUserBlocks = require("./create_user_blocks");
const createContactReports = require("./create_contact_reports");
const addEmailChangeFieldsToUsers = require("./add_email_change_fields_to_users");
const addPasswordChangedAtToUsers = require("./add_password_changed_at_to_users");
const addPreferredLanguageToUsers = require("./add_preferred_language_to_users");
const fixTokenExpiryTimestamps = require("./fix_token_expiry_timestamps");
const addSourceToUserTags = require("./add_source_to_user_tags");
const addIdTokensToProseEvents = require("./add_id_tokens_to_prose_events");
const fixWrongApproverIdsInApplauseEvents = require(
  "./fix_wrong_approver_ids_in_applause_events"
);
const addPersonIdsToLegacyMarkerDms = require(
  "./add_person_ids_to_legacy_marker_dms"
);

const runMigrations = async () => {
  try {
    console.log("Running migrations...");

    await fixMessagesTimestamps();
    await createMessageReads();
    await addMessageEditColumns();
    await addReplyToId();
    await addLegalConsentToUsers();
    await createUserBlocks();
    await createContactReports();
    await addEmailChangeFieldsToUsers();
    await addPasswordChangedAtToUsers();
    await addPreferredLanguageToUsers();
    await fixTokenExpiryTimestamps();
    await addSourceToUserTags();
    // ⚠️ The first DATA migration here: it rewrites stored message
    // text rather than the schema. Idempotent by guard and wrapped in its
    // own transaction, because the catch below does not rethrow.
    await addIdTokensToProseEvents();
    // 🔴 Runs AFTER the backfill above, and corrects it. That migration wrote
    // `sender_id` into the 🎉 APPROVER slot on the premise that the sender is
    // the approver; `deletion-audit/24` measured the premise as false for 203
    // of 289 rows. Order matters: this one only recognises a row by the wrong
    // id being present, so it must not run before the id is written.
    await fixWrongApproverIdsInApplauseEvents();
    // Step 3 of the name bug: the 171 marker DMs of 4–14 January 2026 that
    // stored two names and no ids. Independent of the two migrations above (it
    // reads no prose slot). Dry run: `deletion-audit/32`.
    await addPersonIdsToLegacyMarkerDms();

    console.log("All migrations completed successfully!");
  } catch (error) {
    // 🔴 This catch does NOT rethrow, so `migrate.js` goes on to print
    // "Migration completed successfully" after a failure — a failed run is
    // indistinguishable from a clean one. Noted 2026-10-06 while adding the
    // first DATA migration; left as it is because changing it affects every
    // migration and deserves its own change. Until then a data migration must
    // be idempotent, must own its transaction, and must be verifiable from
    // OUTSIDE — `deletion-audit/22` is that check for the prose id backfill.
    console.error("Error running migrations:", error);
  }
};

module.exports = runMigrations;
