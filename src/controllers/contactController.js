const Joi = require("joi");
const emailService = require("../services/emailService");
const contactReportModel = require("../models/contactReportModel");
const { verifyTurnstileToken } = require("../utils/turnstileVerify");
const { validateContactAttachments } = require("../utils/contactAttachments");
const { DEFAULT_LANGUAGE, isSupportedLanguage } = require("../config/languages");
const { CONTACT_ERROR_CODES } = require("../config/contactErrors");
const {
  LEGACY_REPORT_TOPIC,
  isReportTopic,
  resolveTopicLabel,
} = require("../config/contactTopics");

const contactSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  email: Joi.string().trim().email().required(),
  topic: Joi.string().trim().max(150).allow("", null),
  message: Joi.string().trim().min(1).max(5000).required(),
  turnstile_token: Joi.string().optional(),
  // The language the reporter's UI was in, so the receipt email matches the
  // page they filed from. There is no user row to resolve it from — a DSA
  // report may be filed without an account — so it has to travel with the
  // request.
  //
  // ⚠️ Deliberately NOT `.valid(...SUPPORTED_LANGUAGES)`, unlike the
  // registration schema. That rule would turn an unexpected code into a 400 and
  // reject the whole report over the language of its acknowledgement. This is
  // the abuse channel: it must accept the report and get the language wrong,
  // never the reverse. `resolveReceiptLanguage` below drops anything unknown.
  language: Joi.string().trim().max(35).allow("", null),
});

const successResponse = {
  success: true,
  message: "Your message has been sent. We'll get back to you soon.",
};

const getAttachmentMetadata = (files = []) =>
  (files || []).map((file) => ({
    fileName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  }));

const getReportSuccessResponse = (referenceId) => ({
  success: true,
  message: `Your report has been received. Reference ID: ${referenceId}.`,
  data: {
    referenceId,
  },
});

const updateReportEmailStatus = async (report, statusUpdate) => {
  if (!report) return;

  try {
    await contactReportModel.updateEmailStatus(report.id, statusUpdate);
  } catch (statusError) {
    console.error("Failed to update report email status:", statusError);
  }
};

// An unsupported or absent code becomes the default rather than travelling on
// as-is. `emailCopy()` would fall back too, but doing it here keeps the choice
// visible at the point where it is made and is what the tests pin down.
const resolveReceiptLanguage = (language) =>
  isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE;

// Acknowledge receipt to the reporter. Best-effort: the report is already
// persisted and its reference ID shown on screen, so a failed receipt email
// must never fail the request.
const sendReportReceipt = async (report, { name, email, language }) => {
  if (!report) return;

  try {
    await emailService.sendReportReceiptEmail(
      name,
      email,
      report.reference_code,
      resolveReceiptLanguage(language),
    );
  } catch (receiptError) {
    console.error("Failed to send report receipt email:", receiptError);
  }
};

const contactController = {
  async submitContactForm(req, res) {
    try {
      const { error, value } = contactSchema.validate(req.body, { stripUnknown: true });

      if (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("Contact form validation error:", error.details);
        }

        return res.status(400).json({
          success: false,
          code: CONTACT_ERROR_CODES.INVALID_INPUT,
          message: "Invalid input data",
          // ⚠️ Raw Joi text, and developer-facing. No frontend renders it —
          // Contact.jsx reads `message` only — so it is deliberately left
          // untranslated rather than given codes of its own.
          errors: error.details.map((detail) => detail.message),
        });
      }

      const attachmentValidation = validateContactAttachments(req.files);
      if (!attachmentValidation.valid) {
        return res.status(400).json({
          success: false,
          code: attachmentValidation.code,
          values: attachmentValidation.values,
          message: attachmentValidation.error,
        });
      }

      const { name, email, topic, message, turnstile_token, language } = value;
      // The code decides; the label is only ever written down. Keeping the two
      // apart is what lets the dropdown be translated - see contactTopics.js.
      const topicLabel = resolveTopicLabel(topic);
      const shouldPersistReport = isReportTopic(topic);
      let report = null;

      if (process.env.TURNSTILE_SECRET_KEY) {
        if (!turnstile_token) {
          return res.status(400).json({
            success: false,
            code: CONTACT_ERROR_CODES.CAPTCHA_REQUIRED,
            message: "CAPTCHA verification is required",
          });
        }

        const turnstileResult = await verifyTurnstileToken(turnstile_token);

        if (!turnstileResult.success) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("Turnstile verification failed:", turnstileResult.error);
          }

          return res.status(400).json({
            success: false,
            code: CONTACT_ERROR_CODES.CAPTCHA_FAILED,
            message: "CAPTCHA verification failed. Please try again.",
          });
        }
      }

      if (shouldPersistReport) {
        try {
          report = await contactReportModel.createReport({
            name,
            email,
            topic: topicLabel || LEGACY_REPORT_TOPIC,
            message,
            attachments: getAttachmentMetadata(req.files),
          });
        } catch (reportError) {
          console.error("Failed to persist contact report:", reportError);

          return res.status(500).json({
            success: false,
            code: CONTACT_ERROR_CODES.REPORT_PERSIST_FAILED,
            message:
              "Failed to receive your report. Please try again in a few minutes.",
          });
        }
      }

      try {
        const emailTopic = report
          ? `${topicLabel || LEGACY_REPORT_TOPIC} (${report.reference_code})`
          : topicLabel;
        const emailResult = await emailService.sendContactFormEmail(
          name,
          email,
          emailTopic,
          message,
          req.files,
        );

        if (!emailResult?.success) {
          console.error("Failed to send contact form email");
          await updateReportEmailStatus(report, {
            emailStatus: "failed",
            emailError: "Contact form email service returned failure",
          });
        } else if (report) {
          await updateReportEmailStatus(report, {
            emailStatus: "sent",
            emailMessageId: emailResult.messageId,
          });
        }
      } catch (emailError) {
        console.error("Contact form email send error:", emailError);
        await updateReportEmailStatus(report, {
          emailStatus: "failed",
          emailError: emailError.message,
        });
      }

      await sendReportReceipt(report, { name, email, language });

      if (report) {
        return res
          .status(200)
          .json(getReportSuccessResponse(report.reference_code));
      }

      return res.status(200).json(successResponse);
    } catch (error) {
      console.error("Contact form submission error:", error);

      return res.status(500).json({
        success: false,
        code: CONTACT_ERROR_CODES.CONTACT_FAILED,
        message: "Failed to submit contact form",
      });
    }
  },
};

module.exports = contactController;
