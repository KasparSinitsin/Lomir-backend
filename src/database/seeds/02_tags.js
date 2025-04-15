const db = require('../../config/database');

const seedTags = async () => {
  try {
    // Clear existing data
   // await db.query('TRUNCATE tags CASCADE');
    
    // Insert tags by category
    // Technical Skills
    await db.query(`
      INSERT INTO tags (name, category)
      VALUES 
        ('JavaScript', 'Technical Skills'),
        ('React', 'Technical Skills'),
        ('Node.js', 'Technical Skills'),
        ('UX Design', 'Technical Skills'),
        ('Python', 'Technical Skills'),
        ('Mobile Development', 'Technical Skills'),
        ('Database Design', 'Technical Skills'),
        ('DevOps', 'Technical Skills'),
        ('Flutter', 'Technical Skills'),
        ('GraphQL', 'Technical Skills')
    `);
    
    // Project Types
    await db.query(`
      INSERT INTO tags (name, category)
      VALUES 
        ('Web App', 'Project Types'),
        ('Mobile App', 'Project Types'),
        ('Startup', 'Project Types'),
        ('Open Source', 'Project Types'),
        ('Social Impact', 'Project Types'),
        ('Game Development', 'Project Types'),
        ('AI/ML', 'Project Types'),
        ('IoT', 'Project Types'),
        ('E-commerce', 'Project Types'),
        ('Educational', 'Project Types')
    `);
    
    // Interests
    await db.query(`
      INSERT INTO tags (name, category)
      VALUES 
        ('Sports', 'Interests'),
        ('Music', 'Interests'),
        ('Art', 'Interests'),
        ('Travel', 'Interests'),
        ('Photography', 'Interests'),
        ('Cooking', 'Interests'),
        ('Reading', 'Interests'),
        ('Gaming', 'Interests'),
        ('Sustainability', 'Interests'),
        ('Health & Wellness', 'Interests')
    `);
    
    // Add user-tag relationships
    // First get user IDs
    const userRes = await db.query('SELECT id FROM users');
    const users = userRes.rows;
    
    // Then get tag IDs
    const tagRes = await db.query('SELECT id FROM tags');
    const tags = tagRes.rows;
    
    // Assign 3-5 random tags to each user
    for (const user of users) {
      // Shuffle and pick random tags
      const shuffledTags = tags.sort(() => 0.5 - Math.random());
      const selectedTags = shuffledTags.slice(0, Math.floor(Math.random() * 3) + 3);
      
      for (const tag of selectedTags) {
        await db.query(`
          INSERT INTO user_tags (user_id, tag_id)
          VALUES ($1, $2)
        `, [user.id, tag.id]);
      }
    }
    
    console.log('Tags and user-tag relationships seeded successfully');
  } catch (error) {
    console.error('Error seeding tags:', error);
    throw error;
  }
};

module.exports = seedTags;