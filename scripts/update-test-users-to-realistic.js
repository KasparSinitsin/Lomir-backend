const db = require('../src/config/database');

const updateTestUsersToRealistic = async () => {
  const client = await db.pool.connect();
  
  try {
    console.log('Starting realistic user data update...');

    // Define realistic European names and data
    const realisticUsers = [
      {
        id: 151, // testuser
        username: 'marcoberlin',
        email: 'marco.weber@email.com',
        firstName: 'Marco',
        lastName: 'Weber',
        bio: 'Software engineer passionate about React and Node.js. Love cycling and exploring Berlin.',
        postalCode: '10115' // Berlin, Germany
      },
      {
        id: 152, // Klausimausi
        username: 'klausmainz',
        email: 'klaus.mueller@email.com',
        firstName: 'Klaus',
        lastName: 'Müller',
        bio: 'Drummer looking to connect with other musicians in the Mainz area.',
        postalCode: '55116' // Mainz, Germany
      },
      {
        id: 154, // Julia2
        username: 'juliawalking',
        email: 'julia.schmidt@email.com',
        firstName: 'Julia',
        lastName: 'Schmidt',
        bio: 'Nordic walking enthusiast seeking active companions for outdoor adventures.',
        postalCode: '0150' // Oslo, Norway
      },
      {
        id: 155, // Julia3
        username: 'juliafit',
        email: 'julia.hansen@email.com',
        firstName: 'Julia',
        lastName: 'Hansen',
        bio: 'Fitness enthusiast and sports lover looking for workout partners.',
        postalCode: '1050' // Copenhagen, Denmark
      },
      {
        id: 156, // NewUser
        username: 'martintech',
        email: 'martin.andersen@email.com',
        firstName: 'Martin',
        lastName: 'Andersen',
        bio: 'Tech professional interested in startup culture and innovation.',
        postalCode: '1050' // Copenhagen, Denmark
      },
      {
        id: 157, // testuser5
        username: 'annadev',
        email: 'anna.kowalski@email.com',
        firstName: 'Anna',
        lastName: 'Kowalski',
        bio: 'Frontend developer specializing in React. Passionate about user experience design.',
        postalCode: '5611' // Eindhoven, Netherlands
      },
      {
        id: 161, // Test
        username: 'carlostech',
        email: 'carlos.garcia@email.com',
        firstName: 'Carlos',
        lastName: 'García',
        bio: 'Full-stack developer and tech enthusiast from Valencia.',
        postalCode: '46001' // Valencia, Spain
      },
      {
        id: 166, // test13
        username: 'sophiearts',
        email: 'sophie.martin@email.com',
        firstName: 'Sophie',
        lastName: 'Martin',
        bio: 'Graphic designer and digital artist passionate about creative collaboration.',
        postalCode: '13001' // Marseille, France
      },
      {
        id: 167, // Test14
        username: 'lucadesign',
        email: 'luca.rossi@email.com',
        firstName: 'Luca',
        lastName: 'Rossi',
        bio: 'UX/UI designer focused on creating intuitive digital experiences.',
        postalCode: '20121' // Milan, Italy
      },
      {
        id: 168, // Test15
        username: 'emmacode',
        email: 'emma.johnson@email.com',
        firstName: 'Emma',
        lastName: 'Johnson',
        bio: 'Software developer interested in open source projects and web technologies.',
        postalCode: 'SW1A 1AA' // London, UK
      },
      {
        id: 169, // Test16
        username: 'davidmusic',
        email: 'david.smith@email.com',
        firstName: 'David',
        lastName: 'Smith',
        bio: 'Music producer and sound engineer looking for creative collaborators.',
        postalCode: 'M1 1AA' // Manchester, UK
      },
      {
        id: 170, // Test17
        username: 'lisatravel',
        email: 'lisa.vanderberg@email.com',
        firstName: 'Lisa',
        lastName: 'van der Berg',
        bio: 'Travel blogger and photographer documenting European adventures.',
        postalCode: '1012' // Amsterdam, Netherlands
      },
      {
        id: 171, // Kaspar1
        username: 'kaspardeveloper',
        email: 'kaspar.dev@email.com',
        firstName: 'Kaspar',
        lastName: 'Sinitsin',
        bio: 'Web developer passionate about modern JavaScript frameworks and design.',
        postalCode: '111 29' // Stockholm, Sweden
      },
      {
        id: 172, // Test18
        username: 'mariaart',
        email: 'maria.lopez@email.com',
        firstName: 'María',
        lastName: 'López',
        bio: 'Visual artist and creative director seeking collaborative art projects.',
        postalCode: '28001' // Madrid, Spain
      },
      {
        id: 173, // test19
        username: 'pierrecode',
        email: 'pierre.dubois@email.com',
        firstName: 'Pierre',
        lastName: 'Dubois',
        bio: 'Backend developer specializing in Python and database architecture.',
        postalCode: '75001' // Paris, France
      },
      {
        id: 174, // Test20
        username: 'jakubgame',
        email: 'jakub.novak@email.com',
        firstName: 'Jakub',
        lastName: 'Novák',
        bio: 'Game developer and 3D artist working on indie gaming projects.',
        postalCode: '110 00' // Prague, Czech Republic
      },
      {
        id: 175, // Test21
        username: 'ingadata',
        email: 'inga.kowalczyk@email.com',
        firstName: 'Inga',
        lastName: 'Kowalczyk',
        bio: 'Data scientist and machine learning enthusiast exploring AI applications.',
        postalCode: '00-001' // Warsaw, Poland
      },
      {
        id: 176, // Test23
        username: 'maxstartup',
        email: 'max.fischer@email.com',
        firstName: 'Max',
        lastName: 'Fischer',
        bio: 'Entrepreneur and startup founder interested in fintech innovations.',
        postalCode: '1010' // Vienna, Austria
      },
      {
        id: 177, // Test25
        username: 'elsagreen',
        email: 'elsa.lindqvist@email.com',
        firstName: 'Elsa',
        lastName: 'Lindqvist',
        bio: 'Environmental engineer working on sustainable technology solutions.',
        postalCode: '1012' // Amsterdam, Netherlands
      },
      {
        id: 178, // Kaspar2
        username: 'kasparmusic',
        email: 'kaspar.music@email.com',
        firstName: 'Kaspar',
        lastName: 'Müller',
        bio: 'Music producer and audio engineer passionate about electronic music.',
        postalCode: '411 01' // Gothenburg, Sweden
      },
      {
        id: 191, // AvatarProfileImageTest
        username: 'alexanderphoto',
        email: 'alexander.petersen@email.com',
        firstName: 'Alexander',
        lastName: 'Petersen',
        bio: 'Professional photographer specializing in portrait and event photography.',
        postalCode: '8000' // Aarhus, Denmark
      },
      {
        id: 193, // BeneTest
        username: 'benedictwriter',
        email: 'benedict.clark@email.com',
        firstName: 'Benedict',
        lastName: 'Clark',
        bio: 'Technical writer and content creator focused on software documentation.',
        postalCode: '00-001' // Warsaw, Poland
      }
    ];

    let updateCount = 0;

    // Update each user
    for (const userData of realisticUsers) {
      await client.query(`
        UPDATE users
        SET 
          username = $1,
          email = $2,
          first_name = $3,
          last_name = $4,
          bio = $5,
          postal_code = $6,
          updated_at = NOW()
        WHERE id = $7
      `, [
        userData.username,
        userData.email,
        userData.firstName,
        userData.lastName,
        userData.bio,
        userData.postalCode,
        userData.id
      ]);

      console.log(`Updated user ${userData.id}: ${userData.firstName} ${userData.lastName} (${userData.postalCode})`);
      updateCount++;
    }

    console.log(`Successfully updated ${updateCount} test users with realistic data`);
    console.log('Realistic user data update completed!');

  } catch (error) {
    console.error('Error updating test users:', error);
    throw error;
  } finally {
    client.release();
    process.exit(0);
  }
};

// Run the function
updateTestUsersToRealistic();