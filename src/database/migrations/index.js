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
const addPersonIdToLegacyLeaveRows = require(
  "./add_person_id_to_legacy_leave_rows"
);
const addApplicantIdToApplauseEvents = require(
  "./add_applicant_id_to_applause_events"
);
const addApplicantIdToRoleApplicationApprovedRows = require(
  "./add_applicant_id_to_role_application_approved_rows"
);

const addPersonIdsToLegacyOwnerBanners = require(
  "./add_person_ids_to_legacy_owner_banners"
);

const addPersonIdsToDuplicateOwnerBanners = require(
  "./add_person_ids_to_duplicate_owner_banners"
);

const scrubDeletedNewOwnersInOwnerBanners = require(
  "./scrub_deleted_new_owners_in_owner_banners"
);

const scrubRealNamesFromDeletionMessages = require(
  "./scrub_real_names_from_deletion_messages"
);

const addSuccessorIdsToDeletionOwnerBanners = require(
  "./add_successor_ids_to_deletion_owner_banners"
);

const addSuccessorIdsConfirmedByNextBanner = require(
  "./add_successor_ids_confirmed_by_next_banner"
);

const scrubDeletedPeopleInApplicationEvents = require(
  "./scrub_deleted_people_in_application_events"
);

const addTeamIdsToLegacyMarkerDms = require(
  "./add_team_ids_to_legacy_marker_dms"
);
const addTeamIdsToClipboardProseDms = require(
  "./add_team_ids_to_clipboard_prose_dms"
);
const mergeLegacyTags = require("./merge_legacy_tags");
const createTagCategoryTables = require("./create_tag_category_tables");
const createTagTranslationTables = require("./create_tag_translation_tables");
const createPendingFileDeletions = require("./create_pending_file_deletions");
const createUnaccentExtension = require("./create_unaccent_extension");
const scrubMentionLabelsOfDeletedAccounts = require("./scrub_mention_labels_of_deleted_accounts");

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
    // own transaction, so a failure leaves nothing half applied.
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
    // Step 3 of the name bug, F1: the 16 legacy `🚪 X has left the team.` rows
    // become `🚪 MEMBER_LEFT:<id>:X`. Dry run: `deletion-audit/33`.
    await addPersonIdToLegacyLeaveRows();
    // Step 4 of the name bug: the 🎉 APPLICANT slot gets its id from the
    // application, found by `reviewed_at = sent_at`. Touches the applicant slot
    // only, so it is independent of #352/#353. Dry run: `deletion-audit/35`.
    await addApplicantIdToApplauseEvents();
    // Step 4 of the name bug: the 22 legacy `<name>'s application for <role> was
    // approved` team messages. Dry run: `deletion-audit/38`.
    await addApplicantIdToRoleApplicationApprovedRows();

    // Both owner slots get ids from the unique sibling DM. Dry run: deletion-audit/40.
    await addPersonIdsToLegacyOwnerBanners();
    // The four banners it left: two double transfers whose DMs carry a renamed
    // team. Disjoint from the above (no DM with a matching team slot), so the
    // order is only for reading. Dry run: deletion-audit/44.
    await addPersonIdsToDuplicateOwnerBanners();
    // Completes the deletion scrub where a banner's NEW owner deleted the
    // account and the row had no id to find; the sender gets its id too.
    // Proof: the deletion-form banner follows. Dry run: deletion-audit/46.
    await scrubDeletedNewOwnersInOwnerBanners();
    // The deletion writer of 2026-04-02..06-15 stored the deleted person's real
    // name; replace it with the placeholder. BEFORE the successor migrations, so
    // 3653/3695 reach them in the same run. Dry run: deletion-audit/51.
    await scrubRealNamesFromDeletionMessages();
    // The successor of a legacy deletion-form banner gets its id from the
    // notification and teams.owner_id of the same deletion. Dry run: 46.
    await addSuccessorIdsToDeletionOwnerBanners();
    // Same banners, second route: the next owner banner, sent by the notified
    // successor and naming it as previous owner. Dry run: deletion-audit/48.
    await addSuccessorIdsConfirmedByNextBanner();
    // Deleted approvers (🎉) and the deleted applicant of a 4A line get the
    // placeholder; with it, #352's guard ends the #352/#353 churn (item 22).
    // Runs after both of them on purpose. Dry run: deletion-audit/54.
    await scrubDeletedPeopleInApplicationEvents();
    // Team ids into slot 1 of the legacy marker DMs whose team still exists and
    // is corroborated beyond its name (item 33). Dry run: deletion-audit/57.
    await addTeamIdsToLegacyMarkerDms();
    // The four "(legacy)" focus areas are merged into their current versions and
    // deleted (item 11). Refuses, and rolls back, if anything else still points at
    // them. Dry run: deletion-audit/71 and 72.
    await mergeLegacyTags();

    // Ids for the tag categories and supercategories; moves the stray "Social Impact" tag 21
    // so each category text exists once (item 11). Additive: the text columns stay.
    // Dry run: deletion-audit/76.
    await createTagCategoryTables();

    // The empty tables for the translated tag names (item 11). Needs the category tables
    // above. The German names arrive through scripts/import-tag-translations.js.
    await createTagTranslationTables();

    // The list of ImageKit files still to delete, retried until they are gone
    // (item 59). Additive and empty; runs before item 35 so a held data
    // migration never keeps it from being created.
    await createPendingFileDeletions();

    // The accent-insensitive search needs the `unaccent` extension (item 52).
    // Additive; must exist before the search code that calls it runs.
    await createUnaccentExtension();

    // The @-mention labels of accounts deleted before the account deletion did
    // it itself get the placeholder, anchored on the id (item 59). Data: runs
    // with the release, never early; before item 35, which stays last.
    // Dry run: deletion-audit/89.
    await scrubMentionLabelsOfDeletedAccounts();

    // Team ids into the quoted team of the legacy 📋 prose DMs (item 35).
    // Needs the item-35 frontend parser live. Dry run: deletion-audit/63.
    await addTeamIdsToClipboardProseDms();

    console.log("All migrations completed successfully!");
  } catch (error) {
    // The first error stops the list: the migrations after it do not run. It is
    // logged and then RETHROWN, so `migrate.js` prints "Migration failed" and
    // exits with 1. Until 2026-10-11 this catch did not rethrow, and a failed run
    // printed "Migration completed successfully" with exit 0 (STATUS item 18).
    // The notes in the migration files that say so describe that time; what they
    // ask still stands: a data migration is idempotent, owns its transaction and
    // can be verified from OUTSIDE (the `deletion-audit` rounds).
    console.error("Error running migrations:", error);
    throw error;
  }
};

module.exports = runMigrations;
