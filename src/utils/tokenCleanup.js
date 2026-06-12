const db = require("../config/database");

const cleanupExpiredPasswordResetTokens = async () => {
  const result = await db.query(`
    UPDATE users
    SET password_reset_token = NULL,
        password_reset_expires = NULL
    WHERE password_reset_expires IS NOT NULL
      AND password_reset_expires < NOW()
  `);

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[TOKEN CLEANUP] Cleared ${result.rowCount || 0} expired password reset token(s)`,
    );
  }

  return { cleared: result.rowCount || 0 };
};

module.exports = {
  cleanupExpiredPasswordResetTokens,
};
