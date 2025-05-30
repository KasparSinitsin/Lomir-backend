// scripts/fix-all-postal-codes.js
const db = require('../src/config/database');

const fixAllPostalCodes = async () => {
  const client = await db.pool.connect();
  
  try {
    console.log('Starting postal code fix for all users...');

    // Well-known postal codes that definitely work with geocoding services
    const reliablePostalCodes = [
      // Germany - Major cities
      '10115', // Berlin
      '80331', // Munich
      '20095', // Hamburg
      '50667', // Cologne
      '60308', // Frankfurt
      '55116', // Mainz
      '70173', // Stuttgart
      '40213', // Düsseldorf
      '30159', // Hannover
      '01067', // Dresden
      
      // UK - Major cities
      'SW1A 1AA', // London
      'M1 1AA', // Manchester
      'B1 1AA', // Birmingham
      'EH1 1AA', // Edinburgh
      'G1 1AA', // Glasgow
      'L1 1AA', // Liverpool
      'LS1 1AA', // Leeds
      'BS1 1AA', // Bristol
      
      // France - Major cities
      '75001', // Paris
      '69001', // Lyon
      '13001', // Marseille
      '33000', // Bordeaux
      '59000', // Lille
      '31000', // Toulouse
      
      // Spain - Major cities
      '28001', // Madrid
      '08001', // Barcelona
      '46001', // Valencia
      '41001', // Seville
      '48001', // Bilbao
      
      // Italy - Major cities
      '00100', // Rome
      '20121', // Milan
      '80100', // Naples
      '10121', // Turin
      '40121', // Bologna
      
      // Netherlands - Major cities
      '1012', // Amsterdam
      '3011', // Rotterdam
      '2511', // The Hague
      '3511', // Utrecht
      '5611', // Eindhoven
    ];

    // Get all users with their current postal codes
    const usersResult = await client.query(`
      SELECT id, username, first_name, last_name, postal_code 
      FROM users 
      ORDER BY id
    `);
    
    const users = usersResult.rows;
    console.log(`Found ${users.length} users to potentially update`);

    let updateCount = 0;

    // Update each user with a reliable postal code
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      
      // Assign postal codes in a rotating fashion to spread users across Europe
      const newPostalCode = reliablePostalCodes[i % reliablePostalCodes.length];
      
      // Only update if the postal code is different
      if (user.postal_code !== newPostalCode) {
        await client.query(`
          UPDATE users
          SET postal_code = $1, updated_at = NOW()
          WHERE id = $2
        `, [newPostalCode, user.id]);

        console.log(`Updated ${user.first_name} ${user.last_name} (${user.username}): ${user.postal_code} → ${newPostalCode}`);
        updateCount++;
      } else {
        console.log(`Skipped ${user.first_name} ${user.last_name} (${user.username}): already has ${newPostalCode}`);
      }
    }

    console.log(`Successfully updated ${updateCount} users with reliable postal codes`);
    console.log('Postal code fix completed!');

  } catch (error) {
    console.error('Error fixing postal codes:', error);
    throw error;
  } finally {
    client.release();
    process.exit(0);
  }
};

// Run the function
fixAllPostalCodes();