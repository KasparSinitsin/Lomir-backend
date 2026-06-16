const crypto = require("crypto");
const db = require("../config/database");

const MAX_EMAIL_ERROR_LENGTH = 500;

const truncate = (value, maxLength) => {
  if (!value) return null;

  const text = String(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const generateReferenceCode = () => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `RPT-${datePart}-${randomPart}`;
};

const contactReportModel = {
  async createReport({ name, email, topic, message, attachments = [] }) {
    const referenceCode = generateReferenceCode();

    const result = await db.query(
      `
      INSERT INTO contact_reports (
        reference_code,
        reporter_name,
        reporter_email,
        topic,
        message,
        attachment_metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id, reference_code, status, email_status, created_at
      `,
      [
        referenceCode,
        name,
        email,
        topic || "Report content or abuse",
        message,
        JSON.stringify(attachments),
      ],
    );

    return result.rows[0];
  },

  async updateEmailStatus(
    reportId,
    { emailStatus, emailMessageId = null, emailError = null },
  ) {
    const result = await db.query(
      `
      UPDATE contact_reports
      SET email_status = $2,
          email_message_id = $3,
          email_error = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, reference_code, status, email_status, updated_at
      `,
      [
        reportId,
        emailStatus,
        emailMessageId || null,
        truncate(emailError, MAX_EMAIL_ERROR_LENGTH),
      ],
    );

    return result.rows[0] || null;
  },
};

module.exports = contactReportModel;
