const runMigrations = require('./src/database/migrations');

(async () => {
  try {
    await runMigrations();
    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
})();