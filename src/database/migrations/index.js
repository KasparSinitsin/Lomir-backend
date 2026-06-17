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

    console.log("All migrations completed successfully!");
  } catch (error) {
    console.error("Error running migrations:", error);
  }
};

module.exports = runMigrations;
