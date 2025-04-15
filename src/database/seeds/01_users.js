const db = require('../../config/database');
const bcrypt = require('bcrypt');

const seedUsers = async () => {
  try {
    // Hash passwords for demo users
    const password = await bcrypt.hash('password123', 10);
    
    // Clear existing data
    await db.query('TRUNCATE users CASCADE');
    
    // Insert demo users
    await db.query(`
      INSERT INTO users (username, email, password_hash, first_name, last_name, bio, postal_code, latitude, longitude)
      VALUES 
        ('johndoe', 'john@example.com', $1, 'John', 'Doe', 'Web developer interested in team projects', '10115', 52.5342, 13.3884),
        ('janedoe', 'jane@example.com', $1, 'Jane', 'Doe', 'UX designer looking for creative teams', '10117', 52.5268, 13.3834),
        ('bobsmith', 'bob@example.com', $1, 'Bob', 'Smith', 'Full-stack developer with focus on React and Node.js', '10119', 52.5316, 13.3864),
        ('alicejones', 'alice@example.com', $1, 'Alice', 'Jones', 'Project manager with agile experience', '10178', 52.5200, 13.4050),
        ('mikeross', 'mike@example.com', $1, 'Mike', 'Ross', 'Mobile developer specializing in React Native', '10243', 52.5103, 13.4700)
    `, [password]);
    
    console.log('Users seeded successfully');
  } catch (error) {
    console.error('Error seeding users:', error);
    throw error;
  }
};

module.exports = seedUsers;