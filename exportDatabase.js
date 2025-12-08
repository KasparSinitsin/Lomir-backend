const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Create exports directory if it doesn't exist
const exportDir = '/Users/juliabaur/Library/CloudStorage/OneDrive-Persönlich/Dokumente/00 Beruf & Bewerbung/01 Lernen/Programmieren/WBS Coding School/04 Projects/01-final-project/00-Repos/backup';
if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir, { recursive: true });
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const exportTable = async (tableName, query = null) => {
  try {
    const queryString = query || `SELECT * FROM ${tableName} ORDER BY id`;
    console.log(`Exporting ${tableName}...`);
    
    const result = await pool.query(queryString);
    
    const filePath = path.join(exportDir, `${tableName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(result.rows, null, 2));
    
    console.log(`✓ Exported ${result.rows.length} rows from ${tableName}`);
    return result.rows.length;
  } catch (error) {
    console.error(`✗ Error exporting ${tableName}:`, error.message);
    return 0;
  }
};

const exportDatabase = async () => {
  try {
    console.log('Starting database export...\n');
    
    const stats = {};

    // Export all tables
    stats.users = await exportTable('users');
    stats.tags = await exportTable('tags');
    stats.teams = await exportTable('teams');
    stats.team_members = await exportTable('team_members');
    stats.team_applications = await exportTable('team_applications');
    stats.user_tags = await exportTable('user_tags');
    stats.team_tags = await exportTable('team_tags');
    stats.badges = await exportTable('badges');
    stats.user_badges = await exportTable('user_badges');
    stats.messages = await exportTable('messages');

    // Create a summary file
    const summary = {
      exportDate: new Date().toISOString(),
      tables: stats,
      totalRows: Object.values(stats).reduce((sum, count) => sum + count, 0)
    };

    fs.writeFileSync(
      path.join(exportDir, '_export_summary.json'),
      JSON.stringify(summary, null, 2)
    );

    console.log('\n' + '='.repeat(50));
    console.log('Export completed successfully!');
    console.log('='.repeat(50));
    console.log(`Total rows exported: ${summary.totalRows}`);
    console.log(`Files saved in: ${exportDir}`);
    console.log('\nTable breakdown:');
    Object.entries(stats).forEach(([table, count]) => {
      console.log(`  - ${table}: ${count} rows`);
    });

  } catch (error) {
    console.error('Fatal error during export:', error);
  } finally {
    await pool.end();
  }
};

// Run the export
exportDatabase();