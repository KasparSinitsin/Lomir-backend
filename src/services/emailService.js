const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// Use test email for development, our domain for production later
const FROM_EMAIL = "onboarding@resend.dev";

const emailService = {
  /**
   * Send verification email to new user
   */
  async sendVerificationEmail(email, token, username) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

    try {
      const { data, error } = await resend.emails.send({
        from: `Lomir <${FROM_EMAIL}>`,
        to: email,
        subject: "Verify your Lomir account",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #6366f1; margin-bottom: 24px;">Welcome to Lomir, ${username}!</h2>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              Thanks for signing up! Please verify your email address by clicking the button below:
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${verificationUrl}" 
                 style="display: inline-block; background-color: #6366f1; color: white; 
                        padding: 14px 28px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                Verify Email Address
              </a>
            </div>
            
            <p style="font-size: 14px; color: #666; line-height: 1.6;">
              This link will expire in 24 hours. If you didn't create a Lomir account, 
              you can safely ignore this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
            
            <p style="font-size: 12px; color: #999;">
              If the button doesn't work, copy and paste this link into your browser:<br/>
              <a href="${verificationUrl}" style="color: #6366f1;">${verificationUrl}</a>
            </p>
          </div>
        `,
      });

      if (error) {
        console.error("Resend error:", error);
        return { success: false, error: error.message };
      }

      console.log("Verification email sent:", data?.id);
      return { success: true, messageId: data?.id };
    } catch (error) {
      console.error("Email send error:", error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send password reset email (for future use)
   */
  async sendPasswordResetEmail(email, token, username) {
    console.log("Password reset email not implemented yet");
    return { success: false, error: "Not implemented" };
  },
};

module.exports = emailService;
