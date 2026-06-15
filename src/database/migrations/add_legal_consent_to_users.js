const db = require("../../config/database");

const addLegalConsentToUsers = async () => {
  try {
    await db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS accepted_privacy_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS confirmed_age_16_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS accepted_terms_version TEXT,
        ADD COLUMN IF NOT EXISTS accepted_privacy_version TEXT,
        ADD COLUMN IF NOT EXISTS confirmed_age_16_version TEXT
    `);
    console.log("Legal consent columns added to users (or already exist)");
  } catch (error) {
    console.error("Error adding legal consent columns to users:", error);
    throw error;
  }
};

module.exports = addLegalConsentToUsers;
