const addUserVisibilityColumn = require('./add_visibility_to_users');

const runVisibilityMigration = async () => {
  try {
    console.log('Starting user visibility migration...');
    await addUserVisibilityColumn();
    console.log('User visibility migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error running user visibility migration:', error);
    process.exit(1);
  }
};

runVisibilityMigration();