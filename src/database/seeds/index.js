const seedUsers = require('./01_users');
const seedTags = require('./02_tags');
const seedTeams = require('./03_teams');
const seedBadges = require('./04_badges');
const seedMoreUsers = require('./05_more_users');
const seedMessages = require('./06_messages');

const runSeeds = async () => {
  try {
    console.log('Starting database seeding...');
    
    await seedUsers();
    await seedTags();
    await seedTeams();
    await seedBadges();
    await seedMoreUsers();
    await seedMessages();
    
    console.log('Database seeding completed successfully!');
  } catch (error) {
    console.error('Error during database seeding:', error);
  }
};

module.exports = runSeeds;