const seedUsers = require('./01_users');
const seedTags = require('./02_tags');
const seedTeams = require('./03_teams');
const seedBadges = require('./04_badges');

const runSeeds = async () => {
  try {
    console.log('Starting database seeding...');
    
    await seedUsers();
    await seedTags();
    await seedTeams();
    await seedBadges();
    
    console.log('Database seeding completed successfully!');
  } catch (error) {
    console.error('Error during database seeding:', error);
  }
};

module.exports = runSeeds;