const db = require('../../config/database');

const seedMessages = async () => {
  try {
    // Clear existing messages
    await db.query('TRUNCATE messages CASCADE');
    
    // Get all users
    const userRes = await db.query('SELECT id FROM users');
    const users = userRes.rows;
    
    // Get all teams
    const teamRes = await db.query(`
      SELECT t.id, tm.user_id
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
    `);
    const teams = teamRes.rows;
    
    // Group team members by team
    const teamMembersMap = {};
    teams.forEach(row => {
      if (!teamMembersMap[row.id]) {
        teamMembersMap[row.id] = [];
      }
      teamMembersMap[row.id].push(row.user_id);
    });
    
    // Team chat messages templates
    const teamChatMessages = [
      "Hey everyone! Welcome to our team chat.",
      "When is our next meeting scheduled?",
      "I've been working on the design mockups, should be ready by tomorrow.",
      "Has anyone started on the backend implementation?",
      "Just pushed some updates to the GitHub repo. Can someone review my PR?",
      "I'm having an issue with the API integration. Anyone free to help?",
      "The client just sent some feedback on our last demo.",
      "Let's meet on Thursday at 3 PM to discuss the roadmap.",
      "I found this great resource that might be helpful for our project.",
      "Does anyone have experience with GraphQL? I'm having some trouble implementing it.",
      "Great job on the presentation yesterday!",
      "I'll be out of office tomorrow but available on Slack if needed.",
      "Just updated the project board with new tasks.",
      "Who's handling the database schema design?",
      "I think we should revisit our approach to the user authentication flow.",
      "Can someone help me troubleshoot this deployment issue?",
      "The new features are looking great! Really impressed with the progress.",
      "Remember we have a deadline coming up next week.",
      "I've documented the API endpoints in the wiki.",
      "Let's schedule a retrospective for our last sprint."
    ];
    
    // Direct chat messages templates
    const directChatMessages = [
      "Hi! I saw your profile and I'm impressed with your skills.",
      "Would you be interested in joining a project I'm working on?",
      "I noticed we share interests in {tag}. Have you worked on any projects in that area?",
      "Your portfolio is amazing! How long have you been working in this field?",
      "I'm looking for someone with your expertise for a collaboration.",
      "What are you currently working on? I'd love to hear more about your projects.",
      "Do you have time for a quick call this week to discuss potential opportunities?",
      "I'm organizing a team for a hackathon next month. Would you be interested?",
      "Your background in {tag} is exactly what I've been looking for in a teammate.",
      "Have you used {technology} before? I'm trying to decide if it's right for my project.",
      "I'm new to this platform. How has your experience been finding teams here?",
      "Would you be open to mentoring someone learning {tag}?",
      "I saw the badge you received for {skill}. That's impressive!",
      "Are you available for freelance work or just looking for team projects?",
      "I'm building an app that needs someone with your skills. Interested in hearing more?"
    ];
    
    // Response messages
    const responseMessages = [
      "Thanks for reaching out!",
      "I'd be interested in learning more.",
      "Sounds like a great opportunity.",
      "Yes, I've worked with {tag} for about 2 years now.",
      "I'd love to join your project. When are you planning to start?",
      "I'm currently working on something similar actually.",
      "I've got some availability in the coming weeks. Let's discuss details.",
      "What kind of commitment are you looking for?",
      "Could you tell me more about the project scope?",
      "I'm definitely interested. What skills are you looking for specifically?",
      "I've been using {technology} extensively in my recent projects.",
      "A hackathon sounds fun! What's the theme?",
      "I'm primarily looking for part-time collaborations right now.",
      "I'd be happy to chat more. What's the best way to connect?"
    ];
    
    // Seed team messages (20-30 messages per team)
    for (const teamId in teamMembersMap) {
      const teamMembers = teamMembersMap[teamId];
      const messageCount = Math.floor(Math.random() * 11) + 20; // 20-30 messages
      
      // Create a timestamp 30 days ago and gradually move forward
      let timestamp = new Date();
      timestamp.setDate(timestamp.getDate() - 30);
      
      for (let i = 0; i < messageCount; i++) {
        // Move timestamp forward randomly (0-12 hours)
        timestamp = new Date(timestamp.getTime() + (Math.random() * 12 * 60 * 60 * 1000));
        
        // Random sender from team members
        const senderId = teamMembers[Math.floor(Math.random() * teamMembers.length)];
        
        // Random message
        const message = teamChatMessages[Math.floor(Math.random() * teamChatMessages.length)];
        
        await db.query(`
          INSERT INTO messages (sender_id, team_id, content, sent_at)
          VALUES ($1, $2, $3, $4)
        `, [senderId, teamId, message, timestamp]);
      }
    }
    
    // Seed direct messages between users (10-15 conversations)
    const conversationCount = Math.floor(Math.random() * 6) + 10; // 10-15 conversations
    
    for (let i = 0; i < conversationCount; i++) {
      // Select random pair of users
      const shuffledUsers = [...users].sort(() => 0.5 - Math.random());
      const user1 = shuffledUsers[0].id;
      const user2 = shuffledUsers[1].id;
      
      // Get tags for user2 to personalize messages
      const tagRes = await db.query(`
        SELECT t.name FROM tags t
        JOIN user_tags ut ON t.id = ut.tag_id
        WHERE ut.user_id = $1
        LIMIT 5
      `, [user2]);
      
      const userTags = tagRes.rows.map(row => row.name);
      const tag = userTags.length > 0 ? userTags[Math.floor(Math.random() * userTags.length)] : "web development";
      
      // Create a timestamp 14 days ago and gradually move forward
      let timestamp = new Date();
      timestamp.setDate(timestamp.getDate() - 14);
      
      // Initial message
      let initialMessage = directChatMessages[Math.floor(Math.random() * directChatMessages.length)];
      initialMessage = initialMessage.replace("{tag}", tag).replace("{technology}", tag).replace("{skill}", tag);
      
      timestamp = new Date(timestamp.getTime() + (Math.random() * 12 * 60 * 60 * 1000));
      
      await db.query(`
        INSERT INTO messages (sender_id, receiver_id, content, sent_at)
        VALUES ($1, $2, $3, $4)
      `, [user1, user2, initialMessage, timestamp]);
      
      // Response (50% chance)
      if (Math.random() > 0.5) {
        // Move time forward 1-24 hours
        timestamp = new Date(timestamp.getTime() + ((Math.random() * 23 + 1) * 60 * 60 * 1000));
        
        let response = responseMessages[Math.floor(Math.random() * responseMessages.length)];
        response = response.replace("{tag}", tag).replace("{technology}", tag);
        
        await db.query(`
          INSERT INTO messages (sender_id, receiver_id, content, sent_at)
          VALUES ($1, $2, $3, $4)
        `, [user2, user1, response, timestamp]);
        
        // Continued conversation (30% chance)
        if (Math.random() > 0.7) {
          const messageCount = Math.floor(Math.random() * 4) + 2; // 2-5 more messages
          let currentSender = user1;
          let currentReceiver = user2;
          
          for (let j = 0; j < messageCount; j++) {
            // Swap sender and receiver
            [currentSender, currentReceiver] = [currentReceiver, currentSender];
            
            // Move time forward 1-12 hours
            timestamp = new Date(timestamp.getTime() + ((Math.random() * 11 + 1) * 60 * 60 * 1000));
            
            // Random follow-up message
            let followUpMessage;
            if (j === messageCount - 1 && Math.random() > 0.5) {
              followUpMessage = "Great talking to you! Let's connect again soon.";
            } else {
              followUpMessage = responseMessages[Math.floor(Math.random() * responseMessages.length)];
              followUpMessage = followUpMessage.replace("{tag}", tag).replace("{technology}", tag);
            }
            
            await db.query(`
              INSERT INTO messages (sender_id, receiver_id, content, sent_at)
              VALUES ($1, $2, $3, $4)
            `, [currentSender, currentReceiver, followUpMessage, timestamp]);
          }
        }
      }
    }
    
    console.log('Messages seeded successfully');
  } catch (error) {
    console.error('Error seeding messages:', error);
    throw error;
  }
};

module.exports = seedMessages;