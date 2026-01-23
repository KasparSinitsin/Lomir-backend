const Joi = require("joi");
const crypto = require("crypto");
const userModel = require("../models/userModel");
const { generateToken } = require("../utils/jwtUtils");
const emailService = require("../services/emailService");
const db = require("../config/database");

// Validation schema for registration
const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  first_name: Joi.string().allow("", null),
  last_name: Joi.string().allow("", null),
  bio: Joi.string().allow("", null),
  postal_code: Joi.string().allow("", null),
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

      // Create the user (email_verified defaults to FALSE)
      const user = await userModel.createUser(value);

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
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
          },
          requiresVerification: true,
        },
      });
    } catch (error) {
      console.error("Full registration error:", error);
      res.status(500).json({
        success: false,
        message: "Error registering user",
        error: error.message,
      });
    }
  },

  /**
   * Verify user's email with token
   */
  async verifyEmail(req, res) {
    try {
      const { token } = req.params;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: "Verification token is required",
        });
      }

      // Find user with valid token
      const result = await db.query(
        `SELECT id, email, username, first_name, last_name, avatar_url 
         FROM users 
         WHERE verification_token = $1 
         AND verification_token_expires > NOW()
         AND email_verified = FALSE`,
        [token],
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired verification link",
        });
      }

      const user = result.rows[0];

      // Mark email as verified and clear token
      await db.query(
        `UPDATE users 
         SET email_verified = TRUE, 
             verification_token = NULL, 
             verification_token_expires = NULL 
         WHERE id = $1`,
        [user.id],
      );

      // Now generate JWT token since email is verified
      const authToken = generateToken(user);

      res.status(200).json({
        success: true,
        message: "Email verified successfully!",
        data: {
          token: authToken,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            avatar_url: user.avatar_url,
          },
        },
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

      // Find unverified user
      const result = await db.query(
        `SELECT id, username, email FROM users WHERE email = $1 AND email_verified = FALSE`,
        [email],
      );

      if (result.rows.length === 0) {
        // Don't reveal if email exists or is already verified (security)
        return res.status(200).json({
          success: true,
          message:
            "If an unverified account exists with this email, a verification link has been sent.",
        });
      }

      const user = result.rows[0];

      // Generate new verification token
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Update token in database
      await db.query(
        `UPDATE users 
         SET verification_token = $1, verification_token_expires = $2 
         WHERE id = $3`,
        [verificationToken, tokenExpires, user.id],
      );

      // Send new verification email
      await emailService.sendVerificationEmail(
        user.email,
        verificationToken,
        user.username,
      );

      res.status(200).json({
        success: true,
        message:
          "If an unverified account exists with this email, a verification link has been sent.",
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
   * Login user (only if email is verified)
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
          email: user.email,
        });
      }

      const isPasswordValid = await userModel.comparePassword(
        value.password,
        user.password_hash,
      );
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }

      const token = generateToken(user);

      const userResponse = {
        id: user.id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        avatar_url: user.avatar_url,
      };

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: { token, user: userResponse },
      });
    } catch (error) {
      console.error("Login error (catch):", error);
      res.status(500).json({
        success: false,
        message: "Error logging in",
        error: error.message,
      });
    }
  },

  /**
   * Get current user info
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
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            bio: user.bio,
            city: user.city,
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
};

module.exports = authController;
