const Joi = require("joi");
const emailService = require("../services/emailService");
const contactReportModel = require("../models/contactReportModel");
const { verifyTurnstileToken } = require("../utils/turnstileVerify");
const { validateContactAttachments } = require("../utils/contactAttachments");

const REPORT_TOPIC = "Report content or abuse";

const contactSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  email: Joi.string().trim().email().required(),
  topic: Joi.string().trim().max(150).allow("", null),
  message: Joi.string().trim().min(1).max(5000).required(),
  turnstile_token: Joi.string().optional(),
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

const isReportTopic = (topic = "") => topic.trim() === REPORT_TOPIC;

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

// Acknowledge receipt to the reporter. Best-effort: the report is already
// persisted and its reference ID shown on screen, so a failed receipt email
// must never fail the request.
const sendReportReceipt = async (report, { name, email }) => {
  if (!report) return;

  try {
    await emailService.sendReportReceiptEmail(name, email, report.reference_code);
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
          message: "Invalid input data",
          errors: error.details.map((detail) => detail.message),
        });
      }

      const attachmentValidation = validateContactAttachments(req.files);
      if (!attachmentValidation.valid) {
        return res.status(400).json({
          success: false,
          message: attachmentValidation.error,
        });
      }

      const { name, email, topic, message, turnstile_token } = value;
      const shouldPersistReport = isReportTopic(topic || "");
      let report = null;

      if (process.env.TURNSTILE_SECRET_KEY) {
        if (!turnstile_token) {
          return res.status(400).json({
            success: false,
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
            message: "CAPTCHA verification failed. Please try again.",
          });
        }
      }

      if (shouldPersistReport) {
        try {
          report = await contactReportModel.createReport({
            name,
            email,
            topic: topic || REPORT_TOPIC,
            message,
            attachments: getAttachmentMetadata(req.files),
          });
        } catch (reportError) {
          console.error("Failed to persist contact report:", reportError);

          return res.status(500).json({
            success: false,
            message:
              "Failed to receive your report. Please try again in a few minutes.",
          });
        }
      }

      try {
        const emailTopic = report
          ? `${topic || REPORT_TOPIC} (${report.reference_code})`
          : topic;
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

      await sendReportReceipt(report, { name, email });

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
        message: "Failed to submit contact form",
      });
    }
  },
};

module.exports = contactController;
