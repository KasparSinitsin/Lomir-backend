const mailProvider = require("./mailProvider");
const { emailCopy, fill } = require("./emailCopy");

// All transactional email goes out through the provider module (Brevo over the
// HTTPS API, port 443). Render blocks outbound SMTP, so nodemailer/SMTP is no
// longer used. sendEmail is the single transport seam — swap the provider and
// every mail method follows. `attachments` are passed through for the contact
// form (multer files); the provider base64-encodes them.
const sendEmail = async ({ to, subject, html, replyTo, attachments }) => {
  const info = await mailProvider.send({
    to,
    subject,
    html,
    replyTo,
    attachments,
  });

  // Log success in all environments (subject + messageId are not PII; the
  // recipient is intentionally omitted) so a delivery/transport problem is
  // diagnosable from the production logs, not just locally.
  console.log(`Email sent (${subject}): ${info?.messageId}`);

  return { success: true, messageId: info?.messageId };
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

// Shared chrome, so a translated string never has to carry layout with it.
const layout = (inner) => `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
${inner}
          </div>
        `;

const heading = (text) =>
  `            <h2 style="color: #6366f1; margin-bottom: 24px;">${text}</h2>`;

const para = (text, { size = 16, color = "#333" } = {}) =>
  `            <p style="font-size: ${size}px; color: ${color}; line-height: 1.6;">${text}</p>`;

const button = (href, text) => `
            <div style="text-align: center; margin: 32px 0;">
              <a href="${href}"
                 style="display: inline-block; background-color: #6366f1; color: white;
                        padding: 14px 28px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                ${text}
              </a>
            </div>`;

const linkFallback = (href, text) => `
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
            <p style="font-size: 12px; color: #999;">
              ${text}<br/>
              <a href="${href}" style="color: #6366f1;">${href}</a>
            </p>`;

const emailService = {
  /**
   * Send verification email to new user
   */
  async sendVerificationEmail(email, token, username, language) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    const t = emailCopy("verification", language);
    const settingsHref = `${process.env.FRONTEND_URL}/settings`;

    try {
      const emailResult = await sendEmail({
        to: email,
        subject: t.subject,
        html: layout(
          [
            heading(fill(t.heading, { username: escapeHtml(username) })),
            para(t.intro),
            button(verificationUrl, t.button),
            para(
              fill(t.privacy, {
                settingsLink: `<a href="${settingsHref}" style="color: #6366f1;">${t.settingsLink}</a>`,
              }),
              { size: 14 },
            ),
            para(t.expiry, { size: 14, color: "#666" }),
            para(t.ignore, { size: 14, color: "#666" }),
            linkFallback(verificationUrl, t.fallback),
          ].join("\n"),
        ),
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
  async sendPasswordResetEmail(email, token, username, language) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const t = emailCopy("passwordReset", language);
    // Was interpolated unescaped before 2026-09-12.
    const safeUsername = escapeHtml(username || "there");

    try {
      const emailResult = await sendEmail({
        to: email,
        subject: t.subject,
        html: layout(
          [
            heading(t.heading),
            para(fill(t.intro, { username: safeUsername })),
            button(resetUrl, t.button),
            para(t.expiry, { size: 14, color: "#666" }),
            linkFallback(resetUrl, t.fallback),
          ].join("\n"),
        ),
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
  async sendEmailChangeVerificationEmail(email, token, username, language) {
    const confirmUrl = `${process.env.FRONTEND_URL}/verify-email-change?token=${token}`;
    const t = emailCopy("emailChange", language);
    const safeUsername = escapeHtml(username || "there");

    try {
      const emailResult = await sendEmail({
        to: email,
        subject: t.subject,
        html: layout(
          [
            heading(t.heading),
            para(fill(t.intro, { username: safeUsername })),
            button(confirmUrl, t.button),
            para(t.expiry, { size: 14, color: "#666" }),
            para(t.ignore, { size: 14, color: "#666" }),
            linkFallback(confirmUrl, t.fallback),
          ].join("\n"),
        ),
      });

      if (!emailResult.success) {
        return emailResult;
      }

      if (process.env.NODE_ENV !== "production") {
        console.log("Email change verification sent:", emailResult.messageId);
      }
      return { success: true, messageId: emailResult.messageId };
    } catch (error) {
      console.error("Email send error:", error);
      return { success: false };
    }
  },

  /**
   * Notify a user that their account password was just changed.
   * Sent after the change succeeds so a compromised user can react quickly.
   */
  async sendPasswordChangedEmail(email, username, language) {
    const forgotPasswordUrl = `${process.env.FRONTEND_URL}/forgot-password`;
    const loginUrl = `${process.env.FRONTEND_URL}/login`;
    const t = emailCopy("passwordChanged", language);
    const safeUsername = escapeHtml(username || "there");

    try {
      const emailResult = await sendEmail({
        to: email,
        subject: t.subject,
        html: layout(
          [
            heading(t.heading),
            para(fill(t.intro, { username: safeUsername })),
            para(t.ifYou),
            button(loginUrl, t.loginButton),
            para(t.warning, { size: 14, color: "#666" }),
            // Secondary action: outlined, so the safe path stays the loud one.
            `
            <div style="text-align: center; margin: 24px 0;">
              <a href="${forgotPasswordUrl}"
                 style="display: inline-block; background-color: white; color: #6366f1;
                        padding: 12px 24px; text-decoration: none; border-radius: 8px;
                        border: 1px solid #6366f1; font-weight: bold; font-size: 14px;">
                ${t.resetButton}
              </a>
            </div>`,
            linkFallback(forgotPasswordUrl, t.fallback),
          ].join("\n"),
        ),
      });

      if (!emailResult.success) {
        return emailResult;
      }

      if (process.env.NODE_ENV !== "production") {
        console.log("Password changed notice sent:", emailResult.messageId);
      }
      return { success: true, messageId: emailResult.messageId };
    } catch (error) {
      console.error("Email send error:", error);
      return { success: false };
    }
  },

  /**
   * Acknowledge receipt of an abuse / illegal-content report to the reporter
   */
  async sendReportReceiptEmail(name, email, referenceCode, language) {
    const t = emailCopy("reportReceipt", language);
    const safeName = escapeHtml(name || "there");
    const safeReference = escapeHtml(referenceCode);

    try {
      const emailResult = await sendEmail({
        to: email,
        subject: fill(t.subject, {
          reference: cleanHeaderValue(referenceCode),
        }),
        html: layout(
          [
            heading(t.heading),
            para(fill(t.intro, { name: safeName })),
            `
            <div style="background-color: #f5f5f5; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="font-size: 14px; color: #333; line-height: 1.6; margin: 0;">
                <strong>${t.referenceLabel}</strong> ${safeReference}
              </p>
            </div>`,
            para(t.nothingFurther),
            `
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
            <p style="font-size: 12px; color: #999;">
              ${t.footer}
            </p>`,
          ].join("\n"),
        ),
      });

      if (!emailResult.success) {
        return emailResult;
      }

      if (process.env.NODE_ENV !== "production") {
        console.log("Report receipt email sent:", emailResult.messageId);
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
      const mailOptions = {
        to:
          process.env.CONTACT_INBOX_EMAIL ||
          process.env.BREVO_SENDER_EMAIL ||
          process.env.SMTP_USER,
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
        mailOptions.attachments = attachments;
      }

      return await sendEmail(mailOptions);
    } catch (error) {
      console.error("Contact form email send error:", error);
      return { success: false };
    }
  },
};

module.exports = emailService;
