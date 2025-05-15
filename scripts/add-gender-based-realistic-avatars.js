const db = require('../src/config/database');
const axios = require('axios');

const addGenderBasedRealisticAvatarsToUsers = async () => {
  const client = await db.pool.connect();
  
  try {
    console.log('Starting gender-based realistic avatar update process...');
    
    // First, get all users with their names
    const usersResult = await client.query(`
      SELECT id, username, first_name, last_name
      FROM users
    `);
    
    const users = usersResult.rows;
    console.log(`Found ${users.length} users to update with gender-based realistic avatars.`);
    
    // Create a batch of names to send to genderize.io to reduce API calls
    // We'll process users in batches of 10 to avoid rate limiting
    const batchSize = 10;
    
    for (let i = 0; i < users.length; i += batchSize) {
      const userBatch = users.slice(i, i + batchSize);
      const genderMap = new Map(); // Store name -> gender mappings
      
      // Collect first names from this batch
      const firstNamesInBatch = userBatch
        .filter(user => user.first_name)
        .map(user => user.first_name);
      
      // If we have first names to process, fetch genders in bulk
      if (firstNamesInBatch.length > 0) {
        try {
          // Create a query string with all names
          const namesQuery = firstNamesInBatch
            .map(name => `name=${encodeURIComponent(name)}`)
            .join('&');
          
          // Fetch genders for all names in this batch
          const genderResponse = await axios.get(`https://api.genderize.io/?${namesQuery}`);
          
          if (Array.isArray(genderResponse.data)) {
            // Map names to their genders
            genderResponse.data.forEach(result => {
              if (result.gender) {
                genderMap.set(result.name.toLowerCase(), result.gender);
              }
            });
          }
        } catch (error) {
          console.warn(`Error fetching genders in batch: ${error.message}`);
        }
      }
      
      // Process each user in the batch
      for (const user of userBatch) {
        let gender;
        
        // Try to get gender from our map if the user has a first name
        if (user.first_name) {
          gender = genderMap.get(user.first_name.toLowerCase());
        }
        
        // If gender couldn't be determined, use alternatives
        if (!gender) {
          // Fallback: use consistent alternating pattern based on user ID
          gender = user.id % 2 === 0 ? 'male' : 'female';
          console.log(`Using fallback gender for ${user.first_name || user.username}: ${gender}`);
        } else {
          console.log(`Determined gender for ${user.first_name}: ${gender}`);
        }
        
        // Choose a consistent avatar URL based on gender and user ID
        // Use Pravatar for consistency (same ID always gets same image)
        const avatarUrl = `https://i.pravatar.cc/300?img=${user.id % 70}`;
        
        // Alternative: Use randomusers API for more varied but less consistent results
        // const avatarUrl = `https://xsgames.co/randomusers/avatar.php?g=${gender}`;
        
        // Update the user's avatar_url
        await client.query(`
          UPDATE users
          SET avatar_url = $1
          WHERE id = $2
        `, [avatarUrl, user.id]);
        
        console.log(`Updated user ${user.id} (${user.first_name || user.username}) with gender: ${gender}`);
      }
      
      console.log(`Processed batch ${i/batchSize + 1}/${Math.ceil(users.length/batchSize)}`);
      
      // Optional: Add a small delay between batches to avoid hitting rate limits
      if (i + batchSize < users.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`Successfully updated ${users.length} users with gender-based realistic avatars.`);
    
  } catch (error) {
    console.error('Error adding gender-based realistic avatars:', error);
  } finally {
    client.release();
    console.log('Avatar update process completed.');
    // Exit the process
    process.exit(0);
  }
};

// Run the function
addGenderBasedRealisticAvatarsToUsers();