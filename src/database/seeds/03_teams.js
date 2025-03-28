const db = require('../../config/database');

const seedTeams = async () => {
  try {
    // Clear existing data
    await db.query('TRUNCATE teams CASCADE');
    
    // Get user IDs for reference
    const userRes = await db.query('SELECT id FROM users');
    const users = userRes.rows;
    
    // Get tag IDs for reference
    const tagRes = await db.query('SELECT id FROM tags');
    const tags = tagRes.rows;
    
    // Insert demo teams
    const teamsData = [
      {
        name: 'Web Dev Dream Team',
        description: 'Building the next generation of web applications with modern tools and frameworks.',
        creator_id: users[0].id,
        postal_code: '10115',
        latitude: 52.5342,
        longitude: 13.3884,
        max_members: 5
      },
      {
        name: 'Mobile App Innovators',
        description: 'Creating cutting-edge mobile applications for iOS and Android platforms.',
        creator_id: users[1].id,
        postal_code: '10117',
        latitude: 52.5268,
        longitude: 13.3834,
        max_members: 4
      },
      {
        name: 'UX/UI Design Collective',
        description: 'Focusing on beautiful, intuitive user experiences and interfaces for digital products.',
        creator_id: users[2].id,
        postal_code: '10119',
        latitude: 52.5316,
        longitude: 13.3864,
        max_members: 3
      },
      {
        name: 'Sustainability Tech Initiative',
        description: 'Developing technology solutions to address environmental and sustainability challenges.',
        creator_id: users[3].id,
        postal_code: '10178',
        latitude: 52.5200,
        longitude: 13.4050,
        max_members: 6
      }
    ];
    
    // Insert teams and store their IDs
    const teamIds = [];
    for (const team of teamsData) {
      const result = await db.query(`
        INSERT INTO teams (name, description, creator_id, postal_code, latitude, longitude, max_members)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [team.name, team.description, team.creator_id, team.postal_code, team.latitude, team.longitude, team.max_members]);
      
      teamIds.push(result.rows[0].id);
    }
    
    // Add team members (including creators)
    for (let i = 0; i < teamIds.length; i++) {
      const teamId = teamIds[i];
      const creatorId = teamsData[i].creator_id;
      
      // Add creator as member with 'creator' role
      await db.query(`
        INSERT INTO team_members (team_id, user_id, role)
        VALUES ($1, $2, $3)
      `, [teamId, creatorId, 'creator']);
      
      // Add 1-3 additional random members
      const potentialMembers = users.filter(user => user.id !== creatorId);
      const shuffledMembers = potentialMembers.sort(() => 0.5 - Math.random());
      const selectedMembers = shuffledMembers.slice(0, Math.floor(Math.random() * 3) + 1);
      
      for (const member of selectedMembers) {
        await db.query(`
          INSERT INTO team_members (team_id, user_id, role)
          VALUES ($1, $2, $3)
        `, [teamId, member.id, 'member']);
      }
      
      // Add 2-4 tags to each team
      const shuffledTags = tags.sort(() => 0.5 - Math.random());
      const selectedTags = shuffledTags.slice(0, Math.floor(Math.random() * 3) + 2);
      
      for (const tag of selectedTags) {
        await db.query(`
          INSERT INTO team_tags (team_id, tag_id)
          VALUES ($1, $2)
        `, [teamId, tag.id]);
      }
    }
    
    console.log('Teams, team members, and team tags seeded successfully');
  } catch (error) {
    console.error('Error seeding teams:', error);
    throw error;
  }
};

module.exports = seedTeams;