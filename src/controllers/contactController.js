const Joi = require("joi");
const emailService = require("../services/emailService");
const { verifyTurnstileToken } = require("../utils/turnstileVerify");

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

const contactController = {
  async submitContactForm(req, res) {
    try {
      const { error, value } = contactSchema.validate(req.body);

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

      const { name, email, topic, message, turnstile_token } = value;

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

      try {
        const emailResult = await emailService.sendContactFormEmail(
          name,
          email,
          topic,
          message,
        );

        if (!emailResult.success) {
          console.error("Failed to send contact form email");
        }
      } catch (emailError) {
        console.error("Contact form email send error:", emailError);
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
