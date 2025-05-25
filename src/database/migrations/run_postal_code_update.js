const updateUserPostalCodes = require('./update_user_postal_codes');

const runPostalCodeUpdate = async () => {
  try {
    console.log('Starting postal code update migration...');
    await updateUserPostalCodes();
    console.log('Postal code update migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error running postal code update migration:', error);
    process.exit(1);
  }
};

runPostalCodeUpdate();