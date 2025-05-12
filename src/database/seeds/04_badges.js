const db = require('../../config/database');

const seedBadges = async () => {
  try {
    // Clear existing data
    await db.query('TRUNCATE badges CASCADE');
    
    // Insert badges by category
    // Collaboration Skills (Blue)
    await db.query(`
      INSERT INTO badges (name, description, category, teamavatar_url, color)
      VALUES 
        ('Team Player', 'Consistently contributes to team goals and supports fellow members', 'Collaboration Skills', 'puzzle_pieces.svg', '#3B82F6'),
        ('Mediator', 'Helps resolve conflicts and find middle ground between different opinions', 'Collaboration Skills', 'balanced_scales.svg', '#3B82F6'),
        ('Communicator', 'Clear and effective in expressing ideas and listening to others', 'Collaboration Skills', 'speech_bubble.svg', '#3B82F6'),
        ('Motivator', 'Inspires others and maintains positive energy within the team', 'Collaboration Skills', 'flame.svg', '#3B82F6'),
        ('Organizer', 'Keeps projects structured, manages timelines, and coordinates efforts', 'Collaboration Skills', 'clipboard.svg', '#3B82F6'),
        ('Reliable', 'Consistently delivers on commitments and meets deadlines', 'Collaboration Skills', 'anchor.svg', '#3B82F6')
    `);
    
    // Technical Expertise (Green)
    await db.query(`
      INSERT INTO badges (name, description, category, teamavatar_url, color)
      VALUES 
        ('Coder', 'Skilled in programming languages and development', 'Technical Expertise', 'code_brackets.svg', '#10B981'),
        ('Designer', 'Creates visually appealing and user-friendly interfaces', 'Technical Expertise', 'paintbrush.svg', '#10B981'),
        ('Data Whiz', 'Excels at analyzing, interpreting, and visualizing data', 'Technical Expertise', 'bar_chart.svg', '#10B981'),
        ('Tech Support', 'Helps troubleshoot and solve technical problems', 'Technical Expertise', 'wrench.svg', '#10B981'),
        ('Systems Thinker', 'Understands complex systems and how components interact', 'Technical Expertise', 'connected_nodes.svg', '#10B981'),
        ('Documentation Master', 'Creates clear, thorough, and helpful documentation', 'Technical Expertise', 'document.svg', '#10B981')
    `);
    
    // Creative Thinking (Purple)
    await db.query(`
      INSERT INTO badges (name, description, category, teamavatar_url, color)
      VALUES 
        ('Innovator', 'Consistently brings fresh ideas and novel approaches', 'Creative Thinking', 'lightbulb.svg', '#8B5CF6'),
        ('Problem Solver', 'Finds creative solutions to challenging situations', 'Creative Thinking', 'key.svg', '#8B5CF6'),
        ('Visionary', 'Sees the big picture and envisions future possibilities', 'Creative Thinking', 'telescope.svg', '#8B5CF6'),
        ('Storyteller', 'Communicates ideas effectively through compelling narratives', 'Creative Thinking', 'book.svg', '#8B5CF6'),
        ('Artisan', 'Creates beautiful and high-quality work in any medium', 'Creative Thinking', 'paintbrush_art.svg', '#8B5CF6'),
        ('Outside-the-Box', 'Approaches challenges with unconventional thinking', 'Creative Thinking', 'open_box.svg', '#8B5CF6')
    `);
    
    // Leadership Qualities (Red)
    await db.query(`
      INSERT INTO badges (name, description, category, teamavatar_url, color)
      VALUES 
        ('Decision Maker', 'Makes timely, thoughtful choices that move projects forward', 'Leadership Qualities', 'compass.svg', '#EF4444'),
        ('Mentor', 'Helps others develop their skills through guidance and support', 'Leadership Qualities', 'torch.svg', '#EF4444'),
        ('Initiative Taker', 'Proactively identifies opportunities and takes action', 'Leadership Qualities', 'flag.svg', '#EF4444'),
        ('Delegator', 'Effectively distributes responsibilities based on team strengths', 'Leadership Qualities', 'hands_passing.svg', '#EF4444'),
        ('Strategic Planner', 'Develops comprehensive, long-term approaches to achieving goals', 'Leadership Qualities', 'chess_piece.svg', '#EF4444'),
        ('Feedback Provider', 'Offers constructive criticism that helps others improve', 'Leadership Qualities', 'loop_arrow.svg', '#EF4444')
    `);
    
    // Personal Attributes (Yellow)
    await db.query(`
      INSERT INTO badges (name, description, category, teamavatar_url, color)
      VALUES 
        ('Quick Learner', 'Rapidly adapts to new information and technologies', 'Personal Attributes', 'brain_lightning.svg', '#F59E0B'),
        ('Empathetic', 'Understands others perspectives and emotional needs', 'Personal Attributes', 'heart.svg', '#F59E0B'),
        ('Persistent', 'Overcomes obstacles with determination and resilience', 'Personal Attributes', 'mountain_climber.svg', '#F59E0B'),
        ('Detail-Oriented', 'Notices and addresses small details others might miss', 'Personal Attributes', 'magnifying_glass.svg', '#F59E0B'),
        ('Adaptable', 'Flexibly responds to changing circumstances and requirements', 'Personal Attributes', 'chameleon.svg', '#F59E0B'),
        ('Knowledge Sharer', 'Generously shares expertise and helps others learn', 'Personal Attributes', 'open_book.svg', '#F59E0B')
    `);
    
    // Award some badges to users
    // First get user IDs
    const userRes = await db.query('SELECT id FROM users');
    const users = userRes.rows;
    
    // Then get badge IDs
    const badgeRes = await db.query('SELECT id FROM badges');
    const badges = badgeRes.rows;
    
    // Award 1-3 random badges to each user
    for (const user of users) {
      // Shuffle and pick random badges
      const shuffledBadges = badges.sort(() => 0.5 - Math.random());
      const selectedBadges = shuffledBadges.slice(0, Math.floor(Math.random() * 3) + 1);
      
      for (const badge of selectedBadges) {
        // Pick a random user other than self to award the badge
        const otherUsers = users.filter(u => u.id !== user.id);
        const awarder = otherUsers[Math.floor(Math.random() * otherUsers.length)];
        
        await db.query(`
          INSERT INTO user_badges (user_id, badge_id, awarded_by)
          VALUES ($1, $2, $3)
        `, [user.id, badge.id, awarder.id]);
      }
    }
    
    console.log('Badges and user badges seeded successfully');
  } catch (error) {
    console.error('Error seeding badges:', error);
    throw error;
  }
};

module.exports = seedBadges;