const db = require("../config/database");

const cleanupExpiredPasswordResetTokens = async () => {
  const passwordResetResult = await db.query(`
    UPDATE users
    SET password_reset_token = NULL,
        password_reset_expires = NULL
    WHERE password_reset_expires IS NOT NULL
      AND password_reset_expires < NOW()
  `);

  const emailChangeResult = await db.query(`
    UPDATE users
    SET pending_email = NULL,
        email_change_token = NULL,
        email_change_token_expires = NULL
    WHERE email_change_token_expires IS NOT NULL
      AND email_change_token_expires < NOW()
  `);

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[TOKEN CLEANUP] Cleared ${
        passwordResetResult.rowCount || 0
      } expired password reset token(s) and ${
        emailChangeResult.rowCount || 0
      } expired email change token(s)`,
    );
  }

  return {
    cleared: passwordResetResult.rowCount || 0,
    clearedEmailChangeTokens: emailChangeResult.rowCount || 0,
  };
};

module.exports = {
  cleanupExpiredPasswordResetTokens,
};
