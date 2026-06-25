// Mail transport provider — Brevo transactional email over the HTTPS API
// (port 443). Render blocks outbound SMTP (ETIMEDOUT on connect for 587 and
// 465), so we send over HTTPS instead of nodemailer/SMTP. emailService.sendEmail
// is the single seam that calls this module; to swap providers later, only this
// file changes (the controllers, templates, and email methods stay untouched).

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

const isConfigured = () =>
  Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);

// Accept a reply-to as a plain email string or an object ({ email|address, name }).
const normalizeReplyTo = (replyTo) => {
  if (!replyTo) return undefined;
  if (typeof replyTo === "string") return { email: replyTo };
  const email = replyTo.email || replyTo.address;
  if (!email) return undefined;
  return replyTo.name ? { email, name: replyTo.name } : { email };
};

// Accept multer files ({ originalname, buffer, mimetype }) or pre-mapped
// attachments ({ filename|name, content }); Brevo wants { name, content(base64) }.
const normalizeAttachments = (attachments) => {
  if (!attachments?.length) return undefined;
  return attachments.map((file) => {
    const buf = file.content ?? file.buffer;
    return {
      name: file.filename || file.originalname || file.name,
      content: Buffer.isBuffer(buf)
        ? buf.toString("base64")
        : Buffer.from(buf || "").toString("base64"),
    };
  });
};

/**
 * Send one transactional email via Brevo. Resolves to { messageId } on success
 * and throws on failure, mirroring the previous nodemailer contract so callers
 * (which check `emailResult.success`) stay unchanged.
 */
const send = async ({ to, subject, html, replyTo, attachments }) => {
  if (!isConfigured()) {
    throw new Error(
      "Email provider is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL.",
    );
  }

  const payload = {
    sender: {
      email: process.env.BREVO_SENDER_EMAIL,
      name: process.env.BREVO_SENDER_NAME || "Lomir",
    },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };

  const normalizedReplyTo = normalizeReplyTo(replyTo);
  if (normalizedReplyTo) payload.replyTo = normalizedReplyTo;

  const normalizedAttachments = normalizeAttachments(attachments);
  if (normalizedAttachments) payload.attachment = normalizedAttachments;

  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(`Brevo API responded ${response.status}: ${detail}`);
  }

  const data = await response.json().catch(() => ({}));
  return { messageId: data?.messageId };
};

module.exports = { send, isConfigured };
