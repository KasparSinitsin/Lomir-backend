const db = require("../../config/database");

const createTeamApplicationsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS team_applications (
        id SERIAL PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        applicant_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'draft')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER REFERENCES users(id),
        UNIQUE(team_id, applicant_id)
      );
    `);

    // Create index for faster queries
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_team_applications_team_status 
      ON team_applications(team_id, status);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_team_applications_applicant 
      ON team_applications(applicant_id);
    `);

    console.log("Team Applications table created successfully");
  } catch (error) {
    console.error("Error creating team_applications table:", error);
    throw error;
  }
};

module.exports = createTeamApplicationsTable;
