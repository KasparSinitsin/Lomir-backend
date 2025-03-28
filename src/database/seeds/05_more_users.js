const db = require('../../config/database');
const bcrypt = require('bcrypt');

const seedMoreUsers = async () => {
  try {
    // Hash password for demo users
    const password = await bcrypt.hash('password123', 10);
    
    // European cities with postal codes
    const europeanLocations = [
      // Germany
      { city: 'Berlin', postalCode: '10115', lat: 52.5200, lng: 13.4050 },
      { city: 'Munich', postalCode: '80331', lat: 48.1351, lng: 11.5820 },
      { city: 'Hamburg', postalCode: '20095', lat: 53.5511, lng: 9.9937 },
      { city: 'Cologne', postalCode: '50667', lat: 50.9375, lng: 6.9603 },
      { city: 'Frankfurt', postalCode: '60308', lat: 50.1109, lng: 8.6821 },
      { city: 'Dresden', postalCode: '01067', lat: 51.0504, lng: 13.7373 },
      { city: 'Leipzig', postalCode: '04109', lat: 51.3397, lng: 12.3731 },
      { city: 'Dusseldorf', postalCode: '40213', lat: 51.2277, lng: 6.7735 },
      { city: 'Stuttgart', postalCode: '70173', lat: 48.7758, lng: 9.1829 },
      { city: 'Nuremberg', postalCode: '90402', lat: 49.4521, lng: 11.0767 },
      
      // France
      { city: 'Paris', postalCode: '75001', lat: 48.8566, lng: 2.3522 },
      { city: 'Marseille', postalCode: '13001', lat: 43.2965, lng: 5.3698 },
      { city: 'Lyon', postalCode: '69001', lat: 45.7640, lng: 4.8357 },
      { city: 'Toulouse', postalCode: '31000', lat: 43.6047, lng: 1.4442 },
      { city: 'Nice', postalCode: '06000', lat: 43.7102, lng: 7.2620 },
      { city: 'Nantes', postalCode: '44000', lat: 47.2184, lng: -1.5536 },
      { city: 'Strasbourg', postalCode: '67000', lat: 48.5734, lng: 7.7521 },
      { city: 'Montpellier', postalCode: '34000', lat: 43.6108, lng: 3.8767 },
      { city: 'Bordeaux', postalCode: '33000', lat: 44.8378, lng: -0.5792 },
      { city: 'Lille', postalCode: '59000', lat: 50.6292, lng: 3.0573 },
      
      // Spain
      { city: 'Madrid', postalCode: '28001', lat: 40.4168, lng: -3.7038 },
      { city: 'Barcelona', postalCode: '08001', lat: 41.3851, lng: 2.1734 },
      { city: 'Valencia', postalCode: '46001', lat: 39.4699, lng: -0.3763 },
      { city: 'Seville', postalCode: '41001', lat: 37.3891, lng: -5.9845 },
      { city: 'Zaragoza', postalCode: '50001', lat: 41.6488, lng: -0.8891 },
      { city: 'Malaga', postalCode: '29001', lat: 36.7213, lng: -4.4213 },
      { city: 'Murcia', postalCode: '30001', lat: 37.9922, lng: -1.1307 },
      { city: 'Palma', postalCode: '07001', lat: 39.5696, lng: 2.6502 },
      { city: 'Bilbao', postalCode: '48001', lat: 43.2630, lng: -2.9350 },
      { city: 'Alicante', postalCode: '03001', lat: 38.3452, lng: -0.4815 },
      
      // Italy
      { city: 'Rome', postalCode: '00100', lat: 41.9028, lng: 12.4964 },
      { city: 'Milan', postalCode: '20121', lat: 45.4642, lng: 9.1900 },
      { city: 'Naples', postalCode: '80100', lat: 40.8518, lng: 14.2681 },
      { city: 'Turin', postalCode: '10121', lat: 45.0703, lng: 7.6869 },
      { city: 'Palermo', postalCode: '90133', lat: 38.1157, lng: 13.3615 },
      { city: 'Genoa', postalCode: '16121', lat: 44.4056, lng: 8.9463 },
      { city: 'Bologna', postalCode: '40121', lat: 44.4949, lng: 11.3426 },
      { city: 'Florence', postalCode: '50122', lat: 43.7696, lng: 11.2558 },
      { city: 'Bari', postalCode: '70121', lat: 41.1171, lng: 16.8719 },
      { city: 'Catania', postalCode: '95121', lat: 37.5079, lng: 15.0830 },
      
      // UK
      { city: 'London', postalCode: 'EC1A 1BB', lat: 51.5074, lng: -0.1278 },
      { city: 'Birmingham', postalCode: 'B1 1BB', lat: 52.4862, lng: -1.8904 },
      { city: 'Manchester', postalCode: 'M1 1BB', lat: 53.4808, lng: -2.2426 },
      { city: 'Glasgow', postalCode: 'G1 1BB', lat: 55.8642, lng: -4.2518 },
      { city: 'Liverpool', postalCode: 'L1 1BB', lat: 53.4084, lng: -2.9916 },
      { city: 'Bristol', postalCode: 'BS1 1BB', lat: 51.4545, lng: -2.5879 },
      { city: 'Edinburgh', postalCode: 'EH1 1BB', lat: 55.9533, lng: -3.1883 },
      { city: 'Leeds', postalCode: 'LS1 1BB', lat: 53.8008, lng: -1.5491 },
      { city: 'Sheffield', postalCode: 'S1 1BB', lat: 53.3811, lng: -1.4701 },
      { city: 'Cardiff', postalCode: 'CF10 1BB', lat: 51.4816, lng: -3.1791 },
      
      // Netherlands
      { city: 'Amsterdam', postalCode: '1012', lat: 52.3676, lng: 4.9041 },
      { city: 'Rotterdam', postalCode: '3011', lat: 51.9244, lng: 4.4777 },
      { city: 'The Hague', postalCode: '2511', lat: 52.0705, lng: 4.3007 },
      { city: 'Utrecht', postalCode: '3511', lat: 52.0907, lng: 5.1214 },
      { city: 'Eindhoven', postalCode: '5611', lat: 51.4416, lng: 5.4697 },
      { city: 'Groningen', postalCode: '9711', lat: 53.2194, lng: 6.5665 },
      { city: 'Tilburg', postalCode: '5038', lat: 51.5719, lng: 5.0672 }
    ];
    
    // First names and last names for variety
    const firstNames = [
      'Emma', 'Noah', 'Olivia', 'Liam', 'Ava', 'William', 'Sophia', 'Mason', 'Isabella', 'James',
      'Mia', 'Benjamin', 'Charlotte', 'Jacob', 'Amelia', 'Michael', 'Harper', 'Elijah', 'Evelyn', 'Ethan',
      'Abigail', 'Alexander', 'Emily', 'Daniel', 'Elizabeth', 'Matthew', 'Sofia', 'Aiden', 'Ella', 'Henry',
      'Sarah', 'Joseph', 'Victoria', 'Jackson', 'Scarlett', 'Samuel', 'Madison', 'Sebastian', 'Aria', 'David',
      'Grace', 'Carter', 'Chloe', 'Wyatt', 'Camila', 'Jayden', 'Penelope', 'John', 'Riley', 'Owen',
      'Layla', 'Dylan', 'Lillian', 'Luke', 'Nora', 'Gabriel', 'Zoey', 'Anthony', 'Mila', 'Isaac'
    ];
    
    const lastNames = [
      'Smith', 'Johnson', 'Williams', 'Jones', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor',
      'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Garcia', 'Martinez', 'Robinson',
      'Clark', 'Rodriguez', 'Lewis', 'Lee', 'Walker', 'Hall', 'Allen', 'Young', 'Hernandez', 'King',
      'Wright', 'Lopez', 'Hill', 'Scott', 'Green', 'Adams', 'Baker', 'Gonzalez', 'Nelson', 'Carter',
      'Mitchell', 'Perez', 'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins',
      'Stewart', 'Sanchez', 'Morris', 'Rogers', 'Reed', 'Cook', 'Morgan', 'Bell', 'Murphy', 'Bailey'
    ];
    
    // Bios for users
    const bios = [
      'Frontend developer specializing in React and modern CSS frameworks.',
      'Backend developer with expertise in Node.js and database optimization.',
      'Full-stack developer passionate about building accessible web applications.',
      'Mobile app developer with experience in React Native and Flutter.',
      'UX/UI designer focused on creating intuitive and beautiful interfaces.',
      'DevOps engineer specializing in AWS and automated deployment pipelines.',
      'Project manager with agile certification and experience leading remote teams.',
      'Data scientist interested in machine learning and AI applications.',
      'Game developer using Unity and Unreal Engine.',
      'Blockchain developer exploring Web3 technologies.',
      'Graphic designer with expertise in branding and marketing materials.',
      'Content creator specializing in technical tutorials and documentation.',
      'QA engineer with a focus on test automation.',
      'Systems architect designing scalable cloud solutions.',
      'Product manager passionate about user-centered design.',
      'IoT developer working on smart home and industrial applications.',
      'Cybersecurity specialist with experience in penetration testing.',
      'E-commerce developer building online retail solutions.',
      'AR/VR developer creating immersive experiences.',
      'Technical writer specializing in API documentation and user guides.'
    ];
    
    // Generate 60 European users
    for (let i = 0; i < 60; i++) {
      const location = europeanLocations[i % europeanLocations.length];
      const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
      const username = (firstName + lastName + Math.floor(Math.random() * 100)).toLowerCase();
      const email = `${username}@example.com`;
      const bio = bios[Math.floor(Math.random() * bios.length)];
      
      await db.query(`
        INSERT INTO users (username, email, password_hash, first_name, last_name, bio, postal_code, latitude, longitude)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [username, email, password, firstName, lastName, bio, location.postalCode, location.lat, location.lng]);
    }
    
    // Assign random tags to new users
    const userRes = await db.query('SELECT id FROM users ORDER BY id DESC LIMIT 60');
    const newUsers = userRes.rows;
    
    const tagRes = await db.query('SELECT id FROM tags');
    const tags = tagRes.rows;
    
    // Assign 3-5 random tags to each new user
    for (const user of newUsers) {
      // Shuffle and pick random tags
      const shuffledTags = tags.sort(() => 0.5 - Math.random());
      const selectedTags = shuffledTags.slice(0, Math.floor(Math.random() * 3) + 3);
      
      for (const tag of selectedTags) {
        try {
          await db.query(`
            INSERT INTO user_tags (user_id, tag_id)
            VALUES ($1, $2)
          `, [user.id, tag.id]);
        } catch (error) {
          // Skip duplicates if they occur
          if (!error.message.includes('duplicate key')) {
            throw error;
          }
        }
      }
    }
    
    console.log('Additional 60 European users seeded successfully');
  } catch (error) {
    console.error('Error seeding additional users:', error);
    throw error;
  }
};

module.exports = seedMoreUsers;