const bcrypt = require('bcrypt');
const db = require('../src/config/database');

const resetAllPasswords = async () => {
  const client = await db.pool.connect();
  
  try {
    console.log('Starting password reset process...');
    
    // Hash the new password (123456)
    const password = '123456';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    console.log('Updating all user passwords...');
    
    // Update all users with the new password hash
    const result = await client.query(`
      UPDATE users
      SET password_hash = $1
    `, [hashedPassword]);
    
    console.log(`Successfully updated passwords for ${result.rowCount} users.`);
    
  } catch (error) {
    console.error('Error resetting passwords:', error);
  } finally {
    client.release();
    console.log('Password reset process completed.');
    // Exit the process
    process.exit(0);
  }
};

// Run the function
resetAllPasswords();