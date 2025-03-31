const Joi = require('joi');
const userModel = require('../models/userModel');
const { generateToken } = require('../utils/jwtUtils');

// Validation schema for registration
const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  first_name: Joi.string().allow('', null),
  last_name: Joi.string().allow('', null),
  bio: Joi.string().allow('', null),
  postal_code: Joi.string().allow('', null)
});

// Validation schema for login
const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const authController = {
  /**
   * Register a new user
   */
  async register(req, res) {
    try {
      // Validate request body
      const { error, value } = registerSchema.validate(req.body);
      
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
      }
      
      // Check if user already exists
      const existingUserByEmail = await userModel.findByEmail(value.email);
      if (existingUserByEmail) {
        return res.status(400).json({
          success: false,
          message: 'User with this email already exists'
        });
      }
      
      const existingUserByUsername = await userModel.findByUsername(value.username);
      if (existingUserByUsername) {
        return res.status(400).json({
          success: false,
          message: 'User with this username already exists'
        });
      }
      
      // Create user
      const user = await userModel.createUser(value);
      
      // Generate token
      const token = generateToken(user);
      
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error registering user',
        error: error.message
      });
    }
  },
  
  /**
   * Login a user
   */
  async login(req, res) {
    try {
      // Validate request body
      const { error, value } = loginSchema.validate(req.body);
      
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
      }
      
      // Check if user exists
      const user = await userModel.findByEmail(value.email);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }
      
      // Check if password is correct
      const isPasswordValid = await userModel.comparePassword(value.password, user.password_hash);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }
      
      // Generate token
      const token = generateToken(user);
      
      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error logging in',
        error: error.message
      });
    }
  },
  
  /**
   * Get the current user
   */
  async getCurrentUser(req, res) {
    try {
      const userId = req.user.id;
      
      const user = await userModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      res.status(200).json({
        success: true,
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            bio: user.bio,
            postalCode: user.postal_code,
            avatarUrl: user.avatar_url,
            createdAt: user.created_at
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error getting current user',
        error: error.message
      });
    }
  }
};

module.exports = authController;