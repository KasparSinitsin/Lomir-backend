const Joi = require("joi");
const crypto = require("crypto");
const userModel = require("../models/userModel");
const { generateToken } = require("../utils/jwtUtils");
const emailService = require("../services/emailService");
const db = require("../config/database");
const { geocodeAddress } = require("../utils/geocodingUtil");

// Validation schema for registration
const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  first_name: Joi.string().allow("", null),
  last_name: Joi.string().allow("", null),
  bio: Joi.string().allow("", null),
  postal_code: Joi.string().allow("", null),
  city: Joi.string().allow("", null),
  country: Joi.string().allow("", null),
  avatar_url: Joi.string().uri().allow(null),
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
      console.log("Received registration data (req.body):", req.body);

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

      // Prepare user data
      const userData = {
        ...req.body,
        tags: tags || [],
        avatar_url: req.file ? req.file.path : req.body.avatar_url || null,
      };

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

      // Geocode the address if location data is provided
      let coordinates = null;
      if (value.postal_code || value.city) {
        console.log("Attempting to geocode address for new user...");
        coordinates = await geocodeAddress({
          postal_code: value.postal_code,
          city: value.city,
          country: value.country,
        });

        if (coordinates) {
          console.log(
            `Geocoded coordinates for new user: lat=${coordinates.latitude}, lng=${coordinates.longitude}`,
          );
          value.latitude = coordinates.latitude;
          value.longitude = coordinates.longitude;
          value.state = coordinates.state;
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
        console.error("Failed to send verification email:", emailResult.error);
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
        error: error.message,
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
        error: error.message,
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
        console.error(
          "Failed to resend verification email:",
          emailResult.error,
        );
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
        error: error.message,
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
          message: "Invalid email or password",
        });
      }

      // Check if email is verified
      if (!user.email_verified) {
        return res.status(403).json({
          success: false,
          message: "Please verify your email before logging in",
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
          message: "Invalid email or password",
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
            created_at: user.created_at,
          },
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message: "Error logging in",
        error: error.message,
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
            createdAt: user.created_at,
          },
        },
      });
    } catch (error) {
      console.error("GetCurrentUser error (catch):", error);
      res.status(500).json({
        success: false,
        message: "Error getting current user",
        error: error.message,
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
        console.error(
          "Failed to send password reset email:",
          emailResult.error,
        );
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
        error: error.message,
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

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters",
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
        error: error.message,
      });
    }
  },
};

module.exports = authController;
