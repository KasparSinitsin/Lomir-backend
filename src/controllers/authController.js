const Joi = require("joi");
const crypto = require("crypto");
const userModel = require("../models/userModel");
const { generateToken } = require("../utils/jwtUtils");
const emailService = require("../services/emailService");
const db = require("../config/database");
const { resolveLocationData } = require("../utils/geocodingUtil");
const { verifyTurnstileToken } = require("../utils/turnstileVerify");
const { uploadToImageKit } = require("../middlewares/uploadMiddleware");

// Validation schema for registration
const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-zA-Z])(?=.*[0-9])/)
    .required()
    .messages({
      "string.min": "Password must be at least 8 characters",
      "string.pattern.base":
        "Password must contain at least one letter and one number",
    }),
  first_name: Joi.string().allow("", null),
  last_name: Joi.string().allow("", null),
  bio: Joi.string().allow("", null),
  postal_code: Joi.string().allow("", null),
  city: Joi.string().allow("", null),
  state: Joi.string().allow("", null),
  district: Joi.string().allow("", null),
  country: Joi.string().allow("", null),
  avatar_url: Joi.string().uri().allow(null),
  acceptedTerms: Joi.boolean().truthy("true").valid(true).required().messages({
    "any.only": "Terms of Service must be accepted",
    "any.required": "Terms of Service must be accepted",
  }),
  acceptedPrivacy: Joi.boolean().truthy("true").valid(true).required().messages({
    "any.only": "Privacy Policy must be accepted",
    "any.required": "Privacy Policy must be accepted",
  }),
  turnstile_token: Joi.string().optional(),
  tags: Joi.array()
    .items(
      Joi.object({
        tag_id: Joi.number().integer().required(),
      }),
    )
    .optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

const authController = {
  /**
   * Register a new user and send verification email
   */
  async register(req, res) {
    try {
      // Parse tags if sent as string
      let tags = req.body.tags;
      if (typeof tags === "string") {
        try {
          tags = JSON.parse(tags);
        } catch (parseError) {
          console.error("Error parsing tags (JSON.parse):", parseError);
          tags = [];
        }
      }

      let avatarUrl = req.body.avatar_url || null;

      if (req.file) {
        const uploadResult = await uploadToImageKit(
          req.file.buffer,
          req.file.originalname,
        );
        avatarUrl = uploadResult.url;
      }

      // Prepare user data
      const userData = {
        ...req.body,
        tags: tags || [],
        avatar_url: avatarUrl,
        acceptedTerms: req.body.acceptedTerms ?? req.body.accepted_terms,
        acceptedPrivacy: req.body.acceptedPrivacy ?? req.body.accepted_privacy,
      };
      delete userData.accepted_terms;
      delete userData.accepted_privacy;

      // Validate the payload
      const { error, value } = registerSchema.validate(userData);

      if (error) {
        console.warn("Validation error details:", error.details);
        return res.status(400).json({
          success: false,
          message: "Invalid input data",
          errors: error.details.map((detail) => detail.message),
        });
      }

      const { turnstile_token } = req.body;

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
            console.warn(
              "Turnstile verification failed:",
              turnstileResult.error,
            );
          }

          return res.status(400).json({
            success: false,
            message: "CAPTCHA verification failed. Please try again.",
          });
        }
      }

      // Check for existing users
      const [existingUserByEmail, existingUserByUsername] = await Promise.all([
        userModel.findByEmail(value.email),
        userModel.findByUsername(value.username),
      ]);

      if (existingUserByEmail) {
        return res.status(400).json({
          success: false,
          message: "User with this email already exists",
        });
      }

      if (existingUserByUsername) {
        return res.status(400).json({
          success: false,
          message: "User with this username already exists",
        });
      }

      // Geocode and enrich the location if any location data is provided.
      if (value.country) {
        if (process.env.NODE_ENV !== "production") {
          console.log("Attempting to resolve location for new user...");
        }
        const resolvedLocation = await resolveLocationData({
          postal_code: value.postal_code,
          city: value.city,
          state: value.state,
          district: value.district,
          country: value.country,
        });

        if (resolvedLocation) {
          if (process.env.NODE_ENV !== "production") {
            console.log(
              `Resolved location for new user: lat=${resolvedLocation.latitude}, lng=${resolvedLocation.longitude}`,
            );
          }
          value.postal_code = resolvedLocation.postal_code;
          value.city = resolvedLocation.city;
          value.state = resolvedLocation.state;
          value.district = resolvedLocation.district;
          value.country = resolvedLocation.country;
          value.latitude = resolvedLocation.latitude;
          value.longitude = resolvedLocation.longitude;
        }
      }

      // Create the user (email_verified defaults to FALSE)
      const user = await userModel.createUser(value);

      // --- Save Focus Areas (tags) into user_tags ---
      const tagIds = (value.tags || [])
        .map((t) => Number(t?.tag_id))
        .filter((n) => Number.isFinite(n));

      if (tagIds.length > 0) {
        await db.query(
          `
          INSERT INTO user_tags (user_id, tag_id)
          SELECT $1, UNNEST($2::int[])
          ON CONFLICT DO NOTHING
          `,
          [user.id, tagIds],
        );
      }

      // ── INTERIM BYPASS (disabled — email verification now active via Nodemailer/Gmail SMTP) ──
      // Restore this block if email delivery becomes unavailable and registration needs to work without verification.
      // if (process.env.SKIP_EMAIL_VERIFICATION === "true") {
      //   await db.query(`UPDATE users SET email_verified = TRUE WHERE id = $1`, [
      //     user.id,
      //   ]);
      //
      //   const token = generateToken(user);
      //
      //   return res.status(201).json({
      //     success: true,
      //     message: "Registration successful!",
      //     data: {
      //       token,
      //       user: {
      //         id: user.id,
      //         username: user.username,
      //         email: user.email,
      //         first_name: user.first_name,
      //         last_name: user.last_name,
      //         bio: user.bio,
      //         postal_code: user.postal_code,
      //         city: user.city,
      //         country: user.country,
      //         avatar_url: user.avatar_url,
      //         is_public: user.is_public,
      //         is_synthetic: user.is_synthetic,
      //         created_at: user.created_at,
      //       },
      //     },
      //   });
      // }
      // ── END INTERIM BYPASS ──

      // Generate verification token
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Save verification token to database
      await db.query(
        `UPDATE users 
         SET verification_token = $1, verification_token_expires = $2 
         WHERE id = $3`,
        [verificationToken, tokenExpires, user.id],
      );

      // Send verification email
      const emailResult = await emailService.sendVerificationEmail(
        user.email,
        verificationToken,
        user.username,
      );

      if (!emailResult.success) {
        console.error("Failed to send verification email");
        // Still return success - user was created, they can request a new email
      }

      // Return success WITHOUT a JWT token (user must verify email first)
      res.status(201).json({
        success: true,
        message:
          "Registration successful! Please check your email to verify your account.",
        data: {
          requiresVerification: true,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            is_synthetic: user.is_synthetic,
          },
        },
      });
    } catch (error) {
      console.error("Registration error:", error);

      // Handle unique constraint errors nicely (race-condition safe)
      if (error?.code === "23505") {
        const constraint = String(error.constraint || "");

        if (constraint === "users_username_unique_ci") {
          return res.status(400).json({
            success: false,
            message: "User with this username already exists",
          });
        }

        if (constraint === "users_email_unique_ci") {
          return res.status(400).json({
            success: false,
            message: "User with this email already exists",
          });
        }

        return res.status(400).json({
          success: false,
          message: "Duplicate value violates a unique constraint",
        });
      }

      // default: real server error
      res.status(500).json({
        success: false,
        message: "Error registering user",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

  async checkEmail(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      const result = await db.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
        [email],
      );

      const available = result.rows.length === 0;

      res.status(200).json({
        success: true,
        available,
        ...(available
          ? {}
          : { message: "This email address is already registered." }),
      });
    } catch (error) {
      console.error("Check email error:", error);
      res.status(500).json({
        success: false,
        message: "Error checking email availability",
      });
    }
  },

  async checkUsername(req, res) {
    try {
      const { username } = req.body;

      if (!username) {
        return res.status(400).json({
          success: false,
          message: "Username is required",
        });
      }

      const result = await db.query(
        `SELECT id FROM users WHERE LOWER(username) = LOWER($1)`,
        [username],
      );

      const available = result.rows.length === 0;

      res.status(200).json({
        success: true,
        available,
        ...(available ? {} : { message: "This username is already taken." }),
      });
    } catch (error) {
      console.error("Check username error:", error);
      res.status(500).json({
        success: false,
        message: "Error checking username availability",
      });
    }
  },

  /**
   * Verify user's email address
   */
  async verifyEmail(req, res) {
    try {
      const { token } = req.query;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: "Verification token is required",
        });
      }

      // Find user with this token that hasn't expired
      const result = await db.query(
        `SELECT id, username, email, email_verified 
         FROM users 
         WHERE verification_token = $1 
         AND verification_token_expires > NOW()`,
        [token],
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired verification token",
        });
      }

      const user = result.rows[0];

      // Check if already verified
      if (user.email_verified) {
        return res.status(200).json({
          success: true,
          message: "Email already verified. You can now log in.",
        });
      }

      // Mark email as verified and clear the token
      await db.query(
        `UPDATE users 
         SET email_verified = TRUE, 
             verification_token = NULL, 
             verification_token_expires = NULL 
         WHERE id = $1`,
        [user.id],
      );

      res.status(200).json({
        success: true,
        message: "Email verified successfully! You can now log in.",
      });
    } catch (error) {
      console.error("Email verification error:", error);
      res.status(500).json({
        success: false,
        message: "Error verifying email",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

  /**
   * Resend verification email
   */
  async resendVerification(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      // Find user by email
      const result = await db.query(
        `SELECT id, username, email, email_verified 
   FROM users 
   WHERE LOWER(email) = LOWER($1)`,
        [email],
      );

      if (result.rows.length === 0) {
        // Don't reveal if email exists or not
        return res.status(200).json({
          success: true,
          message:
            "If an account exists with this email, a verification link has been sent.",
        });
      }

      const user = result.rows[0];

      // Check if already verified
      if (user.email_verified) {
        return res.status(400).json({
          success: false,
          message: "Email is already verified. You can log in.",
        });
      }

      // Generate new verification token
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Save new token
      await db.query(
        `UPDATE users 
         SET verification_token = $1, verification_token_expires = $2 
         WHERE id = $3`,
        [verificationToken, tokenExpires, user.id],
      );

      // Send verification email
      const emailResult = await emailService.sendVerificationEmail(
        user.email,
        verificationToken,
        user.username,
      );

      if (!emailResult.success) {
        console.error("Failed to resend verification email");
        return res.status(500).json({
          success: false,
          message: "Failed to send verification email. Please try again later.",
        });
      }

      res.status(200).json({
        success: true,
        message:
          "If an account exists with this email, a verification link has been sent.",
      });
    } catch (error) {
      console.error("Resend verification error:", error);
      res.status(500).json({
        success: false,
        message: "Error sending verification email",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

  /**
   * Login an existing user
   */
  async login(req, res) {
    try {
      const { error, value } = loginSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          message: "Invalid input data",
          errors: error.details.map((detail) => detail.message),
        });
      }

      const user = await userModel.findByEmail(value.email);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid email",
        });
      }

      // Original — enforce email verification for all users
      if (!user.email_verified) {
        // ── INTERIM (disabled): if (!user.email_verified && process.env.SKIP_EMAIL_VERIFICATION !== "true") {
        return res.status(403).json({
          success: false,
          message: "Please verify your email before logging in. Check your inbox for the verification link — it expires 24 hours after registration.",
          requiresVerification: true,
        });
      }

      const isValidPassword = await userModel.verifyPassword(
        value.password,
        user.password_hash,
      );

      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: "Invalid password",
        });
      }

      const token = generateToken(user);

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            bio: user.bio,
            postal_code: user.postal_code,
            city: user.city,
            country: user.country,
            avatar_url: user.avatar_url,
            is_public: user.is_public,
            is_synthetic: user.is_synthetic,
            created_at: user.created_at,
          },
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message: "Error logging in",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

  /**
   * Get current user's profile
   */
  async getCurrentUser(req, res) {
    try {
      const userId = req.user.id;
      const user = await userModel.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "User profile retrieved",
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            bio: user.bio,
            city: user.city,
            country: user.country,
            postalCode: user.postal_code,
            avatarUrl: user.avatar_url,
            isPublic: user.is_public,
            isSynthetic: user.is_synthetic,
            createdAt: user.created_at,
          },
        },
      });
    } catch (error) {
      console.error("GetCurrentUser error (catch):", error);
      res.status(500).json({
        success: false,
        message: "Error getting current user",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

  /**
   * Request password reset - sends email with reset link
   */
  async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      const result = await db.query(
        `SELECT id, username, email 
   FROM users 
   WHERE LOWER(email) = LOWER($1)`,
        [email],
      );

      if (result.rows.length === 0) {
        return res.status(200).json({
          success: true,
          message:
            "If an account exists with this email, a password reset link has been sent.",
        });
      }

      const user = result.rows[0];

      const resetToken = crypto.randomBytes(32).toString("hex");
      const tokenExpires = new Date(Date.now() + 60 * 60 * 1000);

      await db.query(
        `UPDATE users 
         SET password_reset_token = $1, password_reset_expires = $2 
         WHERE id = $3`,
        [resetToken, tokenExpires, user.id],
      );

      const emailResult = await emailService.sendPasswordResetEmail(
        user.email,
        resetToken,
        user.username,
      );

      if (!emailResult.success) {
        console.error("Failed to send password reset email");
      }

      res.status(200).json({
        success: true,
        message:
          "If an account exists with this email, a password reset link has been sent.",
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({
        success: false,
        message: "Error processing password reset request",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

  /**
   * Reset password using token
   */
  async resetPassword(req, res) {
    try {
      const { token, password } = req.body;

      if (!token || !password) {
        return res.status(400).json({
          success: false,
          message: "Token and new password are required",
        });
      }

      if (
        password.length < 8 ||
        !/^(?=.*[a-zA-Z])(?=.*[0-9])/.test(password)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Password must be at least 8 characters and contain at least one letter and one number",
        });
      }

      // Find user with valid reset token
      const result = await db.query(
        `SELECT id, username FROM users 
         WHERE password_reset_token = $1 
         AND password_reset_expires > NOW()`,
        [token],
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset token",
        });
      }

      const user = result.rows[0];

      // Hash new password
      const hashedPassword = await userModel.hashPassword(password);

      // Update password and clear reset token
      await db.query(
        `UPDATE users 
         SET password_hash = $1, 
             password_reset_token = NULL, 
             password_reset_expires = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [hashedPassword, user.id],
      );

      res.status(200).json({
        success: true,
        message: "Password reset successful. You can now log in.",
      });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({
        success: false,
        message: "Error resetting password",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

  /**
   * Change password (authenticated user, requires current password)
   */
  async changePassword(req, res) {
    try {
      const userId = req.user.id;
      const { current_password: currentPassword, new_password: newPassword } =
        req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password and new password are required",
        });
      }

      if (
        newPassword.length < 8 ||
        !/^(?=.*[a-zA-Z])(?=.*[0-9])/.test(newPassword)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Password must be at least 8 characters and contain at least one letter and one number",
        });
      }

      const result = await db.query(
        "SELECT id, password_hash FROM users WHERE id = $1",
        [userId],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const isValid = await userModel.verifyPassword(
        currentPassword,
        result.rows[0].password_hash,
      );

      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect",
        });
      }

      const hashedPassword = await userModel.hashPassword(newPassword);

      await db.query(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        [hashedPassword, userId],
      );

      res
        .status(200)
        .json({ success: true, message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({
        success: false,
        message: "Error changing password",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

  /**
   * Change email (authenticated user, requires current password)
   */
  async changeEmail(req, res) {
    try {
      const userId = req.user.id;
      const { new_email: newEmail, current_password: currentPassword } =
        req.body;

      if (!newEmail || !currentPassword) {
        return res.status(400).json({
          success: false,
          message: "New email and current password are required",
        });
      }

      if (!/\S+@\S+\.\S+/.test(newEmail)) {
        return res.status(400).json({
          success: false,
          message: "Invalid email address",
        });
      }

      const result = await db.query(
        "SELECT id, password_hash, email FROM users WHERE id = $1",
        [userId],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const isValid = await userModel.verifyPassword(
        currentPassword,
        result.rows[0].password_hash,
      );

      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect",
        });
      }

      // Check if email is already taken
      const emailCheck = await db.query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2",
        [newEmail, userId],
      );

      if (emailCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: "This email address is already in use",
        });
      }

      await db.query(
        "UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2",
        [newEmail, userId],
      );

      res
        .status(200)
        .json({ success: true, message: "Email changed successfully" });
    } catch (error) {
      console.error("Change email error:", error);
      res.status(500).json({
        success: false,
        message: "Error changing email",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },
};

module.exports = authController;
