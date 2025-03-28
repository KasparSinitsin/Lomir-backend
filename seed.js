const runSeeds = require('./src/database/seeds');

(async () => {
  try {
    await runSeeds();
    console.log('All seed operations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
})();