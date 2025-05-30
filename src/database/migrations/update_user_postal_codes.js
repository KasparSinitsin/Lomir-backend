const db = require('../../config/database');

const updateUserPostalCodes = async () => {
  try {
    console.log('Starting postal code update migration...');

    // Real European postal codes from various countries
    const europeanPostalCodes = [
      // Germany
      { code: '10115', city: 'Berlin', country: 'DE' },
      { code: '80331', city: 'Munich', country: 'DE' },
      { code: '20095', city: 'Hamburg', country: 'DE' },
      { code: '50667', city: 'Cologne', country: 'DE' },
      { code: '60308', city: 'Frankfurt', country: 'DE' },
      { code: '01067', city: 'Dresden', country: 'DE' },
      { code: '04109', city: 'Leipzig', country: 'DE' },
      { code: '55116', city: 'Mainz', country: 'DE' },
      { code: '70173', city: 'Stuttgart', country: 'DE' },
      { code: '90402', city: 'Nuremberg', country: 'DE' },
      { code: '40213', city: 'Düsseldorf', country: 'DE' },
      { code: '30159', city: 'Hannover', country: 'DE' },
      { code: '28195', city: 'Bremen', country: 'DE' },
      { code: '45127', city: 'Essen', country: 'DE' },
      { code: '44135', city: 'Dortmund', country: 'DE' },
      
      // France
      { code: '75001', city: 'Paris', country: 'FR' },
      { code: '69001', city: 'Lyon', country: 'FR' },
      { code: '13001', city: 'Marseille', country: 'FR' },
      { code: '31000', city: 'Toulouse', country: 'FR' },
      { code: '06000', city: 'Nice', country: 'FR' },
      { code: '44000', city: 'Nantes', country: 'FR' },
      { code: '67000', city: 'Strasbourg', country: 'FR' },
      { code: '34000', city: 'Montpellier', country: 'FR' },
      { code: '33000', city: 'Bordeaux', country: 'FR' },
      { code: '59000', city: 'Lille', country: 'FR' },
      
      // United Kingdom
      { code: 'SW1A 1AA', city: 'London', country: 'GB' },
      { code: 'M1 1AA', city: 'Manchester', country: 'GB' },
      { code: 'B1 1AA', city: 'Birmingham', country: 'GB' },
      { code: 'EH1 1AA', city: 'Edinburgh', country: 'GB' },
      { code: 'G1 1AA', city: 'Glasgow', country: 'GB' },
      { code: 'L1 1AA', city: 'Liverpool', country: 'GB' },
      { code: 'LS1 1AA', city: 'Leeds', country: 'GB' },
      { code: 'S1 1AA', city: 'Sheffield', country: 'GB' },
      { code: 'BS1 1AA', city: 'Bristol', country: 'GB' },
      { code: 'CF10 1AA', city: 'Cardiff', country: 'GB' },
      
      // Spain
      { code: '28001', city: 'Madrid', country: 'ES' },
      { code: '08001', city: 'Barcelona', country: 'ES' },
      { code: '46001', city: 'Valencia', country: 'ES' },
      { code: '41001', city: 'Seville', country: 'ES' },
      { code: '50001', city: 'Zaragoza', country: 'ES' },
      { code: '29001', city: 'Málaga', country: 'ES' },
      { code: '48001', city: 'Bilbao', country: 'ES' },
      { code: '30001', city: 'Murcia', country: 'ES' },
      { code: '07001', city: 'Palma', country: 'ES' },
      { code: '03001', city: 'Alicante', country: 'ES' },
      
      // Italy
      { code: '00100', city: 'Rome', country: 'IT' },
      { code: '20121', city: 'Milan', country: 'IT' },
      { code: '80100', city: 'Naples', country: 'IT' },
      { code: '10121', city: 'Turin', country: 'IT' },
      { code: '90133', city: 'Palermo', country: 'IT' },
      { code: '16121', city: 'Genoa', country: 'IT' },
      { code: '40121', city: 'Bologna', country: 'IT' },
      { code: '50122', city: 'Florence', country: 'IT' },
      { code: '70121', city: 'Bari', country: 'IT' },
      { code: '95121', city: 'Catania', country: 'IT' },
      
      // Netherlands
      { code: '1012', city: 'Amsterdam', country: 'NL' },
      { code: '3011', city: 'Rotterdam', country: 'NL' },
      { code: '2511', city: 'The Hague', country: 'NL' },
      { code: '3511', city: 'Utrecht', country: 'NL' },
      { code: '5611', city: 'Eindhoven', country: 'NL' },
      { code: '9711', city: 'Groningen', country: 'NL' },
      { code: '5038', city: 'Tilburg', country: 'NL' },
      { code: '6511', city: 'Nijmegen', country: 'NL' },
      { code: '7511', city: 'Enschede', country: 'NL' },
      { code: '8011', city: 'Zwolle', country: 'NL' },
      
      // Austria
      { code: '1010', city: 'Vienna', country: 'AT' },
      { code: '5020', city: 'Salzburg', country: 'AT' },
      { code: '6020', city: 'Innsbruck', country: 'AT' },
      { code: '8010', city: 'Graz', country: 'AT' },
      { code: '4020', city: 'Linz', country: 'AT' },
      
      // Switzerland
      { code: '8001', city: 'Zurich', country: 'CH' },
      { code: '3001', city: 'Bern', country: 'CH' },
      { code: '4001', city: 'Basel', country: 'CH' },
      { code: '1201', city: 'Geneva', country: 'CH' },
      { code: '1003', city: 'Lausanne', country: 'CH' },
      
      // Belgium
      { code: '1000', city: 'Brussels', country: 'BE' },
      { code: '2000', city: 'Antwerp', country: 'BE' },
      { code: '9000', city: 'Ghent', country: 'BE' },
      { code: '8000', city: 'Bruges', country: 'BE' },
      { code: '4000', city: 'Liège', country: 'BE' },
      
      // Portugal
      { code: '1000-001', city: 'Lisbon', country: 'PT' },
      { code: '4000-001', city: 'Porto', country: 'PT' },
      { code: '3000-001', city: 'Coimbra', country: 'PT' },
      
      // Poland
      { code: '00-001', city: 'Warsaw', country: 'PL' },
      { code: '30-001', city: 'Krakow', country: 'PL' },
      { code: '80-001', city: 'Gdansk', country: 'PL' },
      
      // Czech Republic
      { code: '110 00', city: 'Prague', country: 'CZ' },
      { code: '602 00', city: 'Brno', country: 'CZ' },
      
      // Sweden
      { code: '111 29', city: 'Stockholm', country: 'SE' },
      { code: '411 01', city: 'Gothenburg', country: 'SE' },
      { code: '211 20', city: 'Malmö', country: 'SE' },
      
      // Denmark
      { code: '1050', city: 'Copenhagen', country: 'DK' },
      { code: '8000', city: 'Aarhus', country: 'DK' },
      
      // Norway
      { code: '0150', city: 'Oslo', country: 'NO' },
      { code: '5003', city: 'Bergen', country: 'NO' }
    ];

    // Get all users
    const usersResult = await db.pool.query('SELECT id, postal_code FROM users ORDER BY id');
    const users = usersResult.rows;

    console.log(`Found ${users.length} users to update`);

    let updateCount = 0;

    // Update users with real postal codes
    for (const user of users) {
      // Pick a random postal code from the array
      const randomPostalCode = europeanPostalCodes[Math.floor(Math.random() * europeanPostalCodes.length)];
      
      // Update the user's postal code
      await db.pool.query(
        'UPDATE users SET postal_code = $1 WHERE id = $2',
        [randomPostalCode.code, user.id]
      );

      console.log(`Updated user ${user.id}: ${user.postal_code} → ${randomPostalCode.code} (${randomPostalCode.city}, ${randomPostalCode.country})`);
      updateCount++;

      // Add a small delay to be respectful to the database
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    console.log(`Successfully updated ${updateCount} users with real European postal codes`);
    console.log('Postal code update migration completed!');

  } catch (error) {
    console.error('Error updating postal codes:', error);
    throw error;
  }
};

module.exports = updateUserPostalCodes;