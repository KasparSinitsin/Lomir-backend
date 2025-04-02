// Script to run all migrations in order
const createUsersTable = require('./01_create_users');
const createTagsTable = require('./02_create_tags');
const createUserTagsTable = require('./03_create_user_tags');
const createTeamsTable = require('./04_create_teams');
const createTeamMembersTable = require('./05_create_team_members');
const createTeamTagsTable = require('./06_create_team_tags');
const createMessagesTable = require('./07_create_messages');
const createBadgesTable = require('./08_create_badges');
const createUserBadgesTable = require('./09_create_user_badges');
const enhanceTagsTable = require('./10_enhance_tags_table');

const runMigrations = async () => {
  try {
    console.log('Running migrations...');
    
    await createUsersTable();
    await createTagsTable();
    await createUserTagsTable();
    await createTeamsTable();
    await createTeamMembersTable();
    await createTeamTagsTable();
    await createMessagesTable();
    await createBadgesTable();
    await createUserBadgesTable();
    await enhanceTagsTable();
    
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Error running migrations:', error);
  }
};

module.exports = runMigrations;