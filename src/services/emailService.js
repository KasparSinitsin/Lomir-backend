// Resend transport — commented out, restore when custom domain is verified (see docs/RESTORE_EMAIL_VERIFICATION_GUIDE.md)
// const { Resend } = require("resend");
const nodemailer = require("nodemailer");

const useSmtp = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
);
const smtpTransporter = useSmtp
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: false, // STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

// const FROM_EMAIL = "onboarding@resend.dev";
const SMTP_FROM = `Lomir <${process.env.SMTP_USER}>`;
// const getResendClient = () => new Resend(process.env.RESEND_API_KEY);

const sendEmail = async ({ to, subject, html, replyTo }) => {
  if (!smtpTransporter) {
    throw new Error(
      "SMTP transport is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.",
    );
  }

  const info = await smtpTransporter.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    html,
    replyTo,
  });

  return { success: true, messageId: info?.messageId };

  // Resend fallback — preserve for future restoration when a custom domain is verified.
  // const { data, error } = await getResendClient().emails.send({
  //   from: `Lomir <${FROM_EMAIL}>`,
  //   to,
  //   subject,
  //   html,
  // });
  //
  // if (error) {
  //   console.error("Resend error:", error);
  //   return { success: false };
  // }
  //
  // return { success: true, messageId: data?.id };
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatMessage = (value) => escapeHtml(value).replace(/\n/g, "<br/>");

const cleanHeaderValue = (value = "") => String(value).replace(/[\r\n]+/g, " ");

const emailService = {
  /**
   * Send verification email to new user
   */
  async sendVerificationEmail(email, token, username) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

    try {
      const emailResult = await sendEmail({
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
            
            <p style="font-size: 14px; color: #333; line-height: 1.6;">
              Once verified, your profile will remain <strong>private by default</strong>.
              Other Lomir users can only find your full profile if you actively make it public in your
              <a href="${process.env.FRONTEND_URL}/settings" style="color: #6366f1;">account settings</a>
              after logging in.
            </p>

            <p style="font-size: 14px; color: #666; line-height: 1.6;">
              This link will expire in <strong>24 hours</strong>. If you don't verify your account
              within this time, your registration will be automatically deleted and you'll need
              to sign up again.
            </p>
            <p style="font-size: 14px; color: #666; line-height: 1.6;">
              If you didn't create a Lomir account, you can safely ignore this email —
              the unverified account will be removed automatically.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
            
            <p style="font-size: 12px; color: #999;">
              If the button doesn't work, copy and paste this link into your browser:<br/>
              <a href="${verificationUrl}" style="color: #6366f1;">${verificationUrl}</a>
            </p>
          </div>
        `,
      });

      if (!emailResult.success) {
        return emailResult;
      }

      if (process.env.NODE_ENV !== "production") {
        console.log("Verification email sent:", emailResult.messageId);
      }
      return { success: true, messageId: emailResult.messageId };
    } catch (error) {
      console.error("Email send error:", error);
      return { success: false };
    }
  },

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email, token, username) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    try {
      const emailResult = await sendEmail({
        to: email,
        subject: "Reset your Lomir password",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #6366f1; margin-bottom: 24px;">Password Reset Request</h2>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              Hi ${username}, we received a request to reset your Lomir password. 
              Click the button below to create a new password:
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" 
                 style="display: inline-block; background-color: #6366f1; color: white; 
                        padding: 14px 28px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                Reset Password
              </a>
            </div>
            
            <p style="font-size: 14px; color: #666; line-height: 1.6;">
              This link will expire in 1 hour. If you didn't request a password reset, 
              you can safely ignore this email - your password will remain unchanged.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
            
            <p style="font-size: 12px; color: #999;">
              If the button doesn't work, copy and paste this link into your browser:<br/>
              <a href="${resetUrl}" style="color: #6366f1;">${resetUrl}</a>
            </p>
          </div>
        `,
      });

      if (!emailResult.success) {
        return emailResult;
      }

      if (process.env.NODE_ENV !== "production") {
        console.log("Password reset email sent:", emailResult.messageId);
      }
      return { success: true, messageId: emailResult.messageId };
    } catch (error) {
      console.error("Email send error:", error);
      return { success: false };
    }
  },

  /**
   * Send verification email before changing an existing account email address
   */
  async sendEmailChangeVerificationEmail(email, token, username) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email-change?token=${token}`;
    const safeUsername = escapeHtml(username || "there");

    try {
      const emailResult = await sendEmail({
        to: email,
        subject: "Confirm your new Lomir email address",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #6366f1; margin-bottom: 24px;">Confirm your new email address</h2>

            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              Hi ${safeUsername}, we received a request to use this email address for your Lomir account.
              Please confirm the change by clicking the button below:
            </p>

            <div style="text-align: center; margin: 32px 0;">
              <a href="${verificationUrl}"
                 style="display: inline-block; background-color: #6366f1; color: white;
                        padding: 14px 28px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                Confirm Email Change
              </a>
            </div>

            <p style="font-size: 14px; color: #666; line-height: 1.6;">
              This link will expire in <strong>24 hours</strong>. Your current email address will stay active
              until this new address is confirmed.
            </p>
            <p style="font-size: 14px; color: #666; line-height: 1.6;">
              If you did not request this change, you can ignore this email.
            </p>

            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />

            <p style="font-size: 12px; color: #999;">
              If the button doesn't work, copy and paste this link into your browser:<br/>
              <a href="${verificationUrl}" style="color: #6366f1;">${verificationUrl}</a>
            </p>
          </div>
        `,
      });

      if (!emailResult.success) {
        return emailResult;
      }

      if (process.env.NODE_ENV !== "production") {
        console.log("Email change verification email sent:", emailResult.messageId);
      }
      return { success: true, messageId: emailResult.messageId };
    } catch (error) {
      console.error("Email send error:", error);
      return { success: false };
    }
  },

  /**
   * Send contact form submission to Lomir inbox
   */
  async sendContactFormEmail(name, email, topic, message, attachments) {
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeTopic = escapeHtml(topic || "General inquiry");
    const safeMessage = formatMessage(message);
    const subjectTopic = cleanHeaderValue(topic || "General inquiry");

    try {
      if (!smtpTransporter) {
        throw new Error("SMTP transport is not configured");
      }

      const mailOptions = {
        from: SMTP_FROM,
        to: process.env.SMTP_USER,
        replyTo: {
          name: cleanHeaderValue(name),
          address: email,
        },
        subject: `New Lomir contact form message: ${subjectTopic}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #6366f1; margin-bottom: 24px;">New Contact Form Message</h2>

            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              A visitor sent a message through the Lomir contact form.
            </p>

            <div style="background-color: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
              <p style="font-size: 14px; color: #333; line-height: 1.6; margin: 0 0 12px;">
                <strong>Name:</strong> ${safeName}
              </p>
              <p style="font-size: 14px; color: #333; line-height: 1.6; margin: 0 0 12px;">
                <strong>Email:</strong> <a href="mailto:${safeEmail}" style="color: #6366f1;">${safeEmail}</a>
              </p>
              <p style="font-size: 14px; color: #333; line-height: 1.6; margin: 0;">
                <strong>Topic:</strong> ${safeTopic}
              </p>
            </div>

            <div style="margin: 24px 0;">
              <h3 style="color: #333; font-size: 18px; margin-bottom: 12px;">Message</h3>
              <p style="font-size: 16px; color: #333; line-height: 1.6; margin: 0;">
                ${safeMessage}
              </p>
            </div>

            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />

            <p style="font-size: 12px; color: #999;">
              Reply directly to this email to respond to ${safeName}.
            </p>
          </div>
        `,
      };

      if (attachments?.length) {
        mailOptions.attachments = attachments.map((file) => ({
          filename: file.originalname,
          content: file.buffer,
          contentType: file.mimetype,
        }));
      }

      const info = await smtpTransporter.sendMail(mailOptions);

      if (process.env.NODE_ENV !== "production") {
        console.log("Contact form email sent:", info?.messageId);
      }

      return { success: true, messageId: info?.messageId };
    } catch (error) {
      console.error("Contact form email send error:", error);
      return { success: false };
    }
  },
};

module.exports = emailService;
