const db = require("../../config/database");

const createContactReports = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS contact_reports (
        id BIGSERIAL PRIMARY KEY,
        reference_code TEXT NOT NULL UNIQUE,
        reporter_name TEXT NOT NULL,
        reporter_email TEXT NOT NULL,
        topic TEXT NOT NULL,
        message TEXT NOT NULL,
        attachment_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'received'
          CHECK (status IN ('received', 'under_review', 'action_taken', 'closed')),
        email_status TEXT NOT NULL DEFAULT 'not_attempted'
          CHECK (email_status IN ('not_attempted', 'sent', 'failed')),
        email_message_id TEXT,
        email_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_reports_status_created_at
        ON contact_reports (status, created_at DESC)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_reports_reporter_email
        ON contact_reports (LOWER(reporter_email))
    `);

    console.log("contact_reports table created (or already exists)");
  } catch (error) {
    console.error("Error creating contact_reports table:", error);
    throw error;
  }
};

module.exports = createContactReports;
