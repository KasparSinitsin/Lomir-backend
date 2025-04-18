const Joi = require('joi');
const userModel = require('../models/userModel');
const { generateToken } = require('../utils/jwtUtils');

// Updated Validation schema for registration to include tags
const registerSchema = Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    first_name: Joi.string().allow('', null),
    last_name: Joi.string().allow('', null),
    bio: Joi.string().allow('', null),
    postal_code: Joi.string().allow('', null),
    avatar_url: Joi.string().uri().allow(null),
    tags: Joi.array().items(
        Joi.object({
            tag_id: Joi.number().integer().required(),
            // Commented out for now
            // experience_level: Joi.string()
            //   .valid('beginner', 'intermediate', 'advanced', 'expert')
            //   .default('beginner')
            //   .optional(),
            // interest_level: Joi.string()
            //   .valid('low', 'medium', 'high', 'very-high')
            //   .default('medium')
            //   .optional()
        })
    ).optional()
});

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required()
});

const authController = {
    async register(req, res) {
        try {
            console.log('Received registration data (req.body):', req.body);

            // Parse tags if sent as string (more robust)
            let tags = req.body.tags;
            if (typeof tags === 'string') {
                try {
                    tags = JSON.parse(tags);
                } catch (parseError) {
                    console.error('Error parsing tags (JSON.parse):', parseError);
                    tags = []; // Default to empty array on parsing error
                }
            }

            // Prepare user data (cleaner)
            const userData = {
                ...req.body,
                tags: tags || [], // Ensure tags is always an array
                avatar_url: req.file ? req.file.path : null
            };

            // Validate the entire payload
            const { error, value } = registerSchema.validate(userData);

            if (error) {
                console.warn('Validation error details:', error.details);
                return res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.details.map(detail => detail.message)
                });
            }

            const [existingUserByEmail, existingUserByUsername] = await Promise.all([
                userModel.findByEmail(value.email),
                userModel.findByUsername(value.username)
            ]);

            if (existingUserByEmail) {
                return res.status(400).json({
                    success: false,
                    message: 'User with this email already exists'
                });
            }

            if (existingUserByUsername) {
                return res.status(400).json({
                    success: false,
                    message: 'User with this username already exists'
                });
            }

            const user = await userModel.createUser(value);
            const token = generateToken(user);

            // Send only essential user data
            const userResponse = {
                id: user.id,
                username: user.username,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                avatar_url: user.avatar_url,
                tags: user.tags || []
            };

            res.status(201).json({
                success: true,
                message: 'User registered successfully',
                data: { token, user: userResponse }
            });

        } catch (error) {
            console.error('Full registration error:', error);
            res.status(500).json({
                success: false,
                message: 'Error registering user',
                error: error.message
            });
        }
    },

    async login(req, res) {
        try {
            const { error, value } = loginSchema.validate(req.body);

            if (error) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.details.map(detail => detail.message)
                });
            }

            const user = await userModel.findByEmail(value.email);
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password'
                });
            }

            const isPasswordValid = await userModel.comparePassword(value.password, user.password_hash);
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password'
                });
            }

            const token = generateToken(user);

            // Send only essential user data
            const userResponse = {
                id: user.id,
                username: user.username,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name
            };

            res.status(200).json({
                success: true,
                message: 'Login successful',
                data: { token, user: userResponse }
            });

        } catch (error) {
            console.error('Login error (catch):', error);
            res.status(500).json({
                success: false,
                message: 'Error logging in',
                error: error.message
            });
        }
    },

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
                        first_name: user.first_name,
                        last_name: user.last_name,
                        bio: user.bio,
                        postalCode: user.postal_code,
                        avatarUrl: user.avatar_url,
                        createdAt: user.created_at
                    }
                }
            });

        } catch (error) {
            console.error('GetCurrentUser error (catch):', error);
            res.status(500).json({
                success: false,
                message: 'Error getting current user',
                error: error.message
            });
        }
    }
};

module.exports = authController;