const db = require('../config/database');
const Joi = require('joi');

// Validation schema for team creation
const teamCreationSchema = Joi.object({
  name: Joi.string()
    .min(3)
    .max(100)
    .required()
    .messages({
      'string.min': 'Team name must be at least 3 characters long',
      'string.max': 'Team name cannot exceed 100 characters',
      'any.required': 'Team name is required'
    }),
  
  description: Joi.string()
    .min(10)
    .max(500)
    .required()
    .messages({
      'string.min': 'Description must be at least 10 characters long',
      'string.max': 'Description cannot exceed 500 characters',
      'any.required': 'Team description is required'
    }),
  
  is_public: Joi.boolean().default(true),
  
  max_members: Joi.number()
    .min(2)
    .max(20)
    .required()
    .messages({
      'number.min': 'Team must have at least 2 members',
      'number.max': 'Team cannot have more than 20 members',
      'any.required': 'Maximum members is required'
    }),
  
  postal_code: Joi.string()
    .required()
    .messages({
      'any.required': 'Postal code is required'
    }),
  
  tags: Joi.array().items(Joi.object({
    tag_id: Joi.number().required(),
    experience_level: Joi.string()
      .valid('beginner', 'intermediate', 'advanced', 'expert')
      .default('beginner'),
    interest_level: Joi.string()
      .valid('low', 'medium', 'high', 'very-high')
      .default('medium')
  })).min(1).messages({
    'array.min': 'At least one tag is required'
  })
});

const createTeam = async (req, res) => {
  try {
    // Get the currently logged-in user's ID from the authentication middleware
    const creatorId = req.user.id;

    // Validate request body
    const { error, value } = teamCreationSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    // Begin a database transaction
    const client = await db.pool.connect();

    try {
      // Start transaction
      await client.query('BEGIN');

      // Insert team details
      const teamResult = await client.query(`
        INSERT INTO teams (
          name, 
          description, 
          creator_id, 
          is_public, 
          max_members, 
          postal_code
        ) VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING id
      `, [
        value.name, 
        value.description, 
        creatorId, 
        value.is_public, 
        value.max_members, 
        value.postal_code
      ]);

      const teamId = teamResult.rows[0].id;

      // Add creator as team member with 'creator' role
      await client.query(`
        INSERT INTO team_members (team_id, user_id, role)
        VALUES ($1, $2, $3)
      `, [teamId, creatorId, 'creator']);

      // Insert team tags
      if (value.tags && value.tags.length > 0) {
        const tagInserts = value.tags.map(tag => 
          client.query(`
            INSERT INTO team_tags (team_id, tag_id)
            VALUES ($1, $2)
          `, [teamId, tag.tag_id])
        );
        await Promise.all(tagInserts);
      }

      // Commit transaction
      await client.query('COMMIT');

      // Return successful response
      res.status(201).json({
        success: true,
        message: 'Team created successfully',
        data: { 
          id: teamId,
          name: value.name,
          description: value.description
        }
      });
    } catch (dbError) {
      // Rollback transaction in case of error
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      // Release the client back to the pool
      client.release();
    }
  } catch (error) {
    console.error('Team creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating team',
      error: error.message
    });
  }
};


const createTeam = async (req, res) => {
    try {
      res.status(201).json({
        success: true,
        message: 'Create team placeholder',
        data: { id: 1 }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error creating team',
        error: error.message
      });
    }
  };
  
  const getAllTeams = async (req, res) => {
    try {
      res.status(200).json({
        success: true,
        message: 'Get all teams placeholder',
        data: []
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching teams',
        error: error.message
      });
    }
  };
  
  const getTeamById = async (req, res) => {
    try {
      const teamId = req.params.id;
      res.status(200).json({
        success: true,
        message: `Get team ${teamId} placeholder`,
        data: { id: teamId, name: 'Sample Team' }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching team',
        error: error.message
      });
    }
  };
  
  const updateTeam = async (req, res) => {
    try {
      const teamId = req.params.id;
      res.status(200).json({
        success: true,
        message: `Update team ${teamId} placeholder`,
        data: { id: teamId }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error updating team',
        error: error.message
      });
    }
  };
  
  const deleteTeam = async (req, res) => {
    try {
      const teamId = req.params.id;
      res.status(200).json({
        success: true,
        message: `Delete team ${teamId} placeholder`,
        data: { id: teamId }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error deleting team',
        error: error.message
      });
    }
  };
  
  const addTeamMember = async (req, res) => {
    try {
      const teamId = req.params.id;
      res.status(200).json({
        success: true,
        message: `Add member to team ${teamId} placeholder`,
        data: { teamId }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error adding team member',
        error: error.message
      });
    }
  };
  
  const removeTeamMember = async (req, res) => {
    try {
      const teamId = req.params.id;
      const userId = req.params.userId;
      res.status(200).json({
        success: true,
        message: `Remove member ${userId} from team ${teamId} placeholder`,
        data: { teamId, userId }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error removing team member',
        error: error.message
      });
    }
  };
  
  module.exports = {
    createTeam,
    getAllTeams,
    getTeamById,
    updateTeam,
    deleteTeam,
    addTeamMember,
    removeTeamMember
  };