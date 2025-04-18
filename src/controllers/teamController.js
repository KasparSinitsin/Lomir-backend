const db = require('../config/database');
const Joi = require('joi');

// Validation schema for team creation
const teamCreationSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(3)
    .max(100)
    .required()
    .messages({
      'string.empty': 'Team name cannot be empty',
      'string.min': 'Team name must be at least 3 characters long',
      'string.max': 'Team name cannot exceed 100 characters',
      'any.required': 'Team name is required'
    }),

  description: Joi.string()
    .trim()
    .min(10)
    .max(500)
    .required()
    .messages({
      'string.empty': 'Team description cannot be empty',
      'string.min': 'Description must be at least 10 characters long',
      'string.max': 'Description cannot exceed 500 characters',
      'any.required': 'Team description is required'
    }),

  is_public: Joi.boolean().default(true),

  max_members: Joi.number()
    .integer()
    .min(2)
    .max(20)
    .required()
    .messages({
      'number.base': 'Maximum members must be a number',
      'number.min': 'Team must have at least 2 members',
      'number.max': 'Team cannot have more than 20 members',
      'any.required': 'Maximum members is required'
    }),

    tags: Joi.array().items(
      Joi.object({
        tag_id: Joi.number().integer().required(),
      })
    ).default([]) // Made this default([]) so it's optional
  });

const createTeam = async (req, res) => {
  const client = await db.pool.connect();
  try {
    console.log('--> Entering createTeam function');
    const creatorId = req.user.id;
    console.log('--> Received team creation request:', req.body);
    console.log('--> Creator ID:', creatorId);

    const { error, value } = teamCreationSchema.validate(req.body);
    if (error) {
      console.error('--> Validation error:', error.details);
      await client.query('ROLLBACK'); // Rollback on validation error
      return res.status(400).json({
        success: false,
        message: 'Invalid input data', // More specific message
        errors: error.details.map(detail => detail.message)
      });
    }
    console.log('--> Joi validation successful');

    await client.query('BEGIN');
    console.log('--> Transaction started');

    const teamResult = await client.query(`
      INSERT INTO teams (
        name, 
        description, 
        creator_id, 
        is_public, 
        max_members, 
        postal_code
      ) VALUES ($1, $2, $3, $4, $5, $6) 
      RETURNING id, name, description, is_public, max_members, postal_code, created_at
    `, [
      value.name,
      value.description,
      creatorId,
      value.is_public,
      value.max_members,
      value.postal_code
    ]);
    const team = teamResult.rows[0];
    console.log('--> Team inserted:', team);

    await client.query(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ($1, $2, $3)
    `, [team.id, creatorId, 'creator']);
    console.log('--> Creator added as member');

    if (value.tags && value.tags.length > 0) {
      const tagIdsToCheck = value.tags.map(tag => tag.tag_id);
      console.log('--> Checking tag IDs:', tagIdsToCheck);
      const tagsExistResult = await client.query(`
        SELECT id FROM tags WHERE id IN (${tagIdsToCheck.join(',')})
      `);
      const existingTagIds = tagsExistResult.rows.map(row => row.id);

      if (existingTagIds.length !== tagIdsToCheck.length) {
        console.error('--> Invalid tag IDs:', tagIdsToCheck.filter(tagId => !existingTagIds.includes(tagId)));
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Invalid input data', // More specific message
          errors: ['One or more of the provided tag IDs do not exist.']
        });
      }
      console.log('--> All tag IDs exist');

      const tagInserts = value.tags.map(tag =>
        client.query(`
          INSERT INTO team_tags (team_id, tag_id)
          VALUES ($1, $2)
        `, [team.id, tag.tag_id])
      );
      await Promise.all(tagInserts);
      console.log('--> Tags inserted');
    }

    await client.query('COMMIT');
    console.log('--> Transaction committed');

    res.status(201).json({
      success: true,
      message: 'Team created successfully',
      data: team
    });
    console.log('--> Successful response sent');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('--> Database error during team creation:', error); // More specific message
    res.status(500).json({
      success: false,
      message: 'Database error while creating team', // More specific message
      errorDetails: error.message,
      fullError: error
    });
  } finally {
    client.release();
    console.log('--> Client released');
  }
  console.log('--> Exiting createTeam function');
};

const getAllTeams = async (req, res) => {
  try {
    // Implement pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Query database with pagination
    const teamsResult = await db.pool.query(`
      SELECT t.*, 
             COUNT(tm.id) AS current_members_count
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      WHERE t.archived_at IS NULL
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    // Get total count for pagination metadata
    const countResult = await db.pool.query(`
      SELECT COUNT(*) FROM teams WHERE archived_at IS NULL
    `);

    const totalTeams = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalTeams / limit);

    res.status(200).json({
      success: true,
      data: teamsResult.rows,
      pagination: {
        total: totalTeams,
        page,
        limit,
        totalPages
      }
    });
  } catch (error) {
    console.error('Database error while fetching teams:', error); // More specific message
    res.status(500).json({
      success: false,
      message: 'Database error while fetching teams', // More specific message
      error: error.message
    });
  }
};

const getTeamById = async (req, res) => {
  try {
    const teamId = req.params.id;

    // Fetch team details
    const teamResult = await db.pool.query(`
      SELECT * FROM teams WHERE id = $1 AND archived_at IS NULL
    `, [teamId]);

    if (teamResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    const team = teamResult.rows[0];

    // Get team members
    const membersResult = await db.pool.query(`
      SELECT tm.user_id, tm.role, tm.joined_at, u.username, u.email
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = $1
    `, [teamId]);

    // Get team tags
    const tagsResult = await db.pool.query(`
      SELECT tt.tag_id, t.name, t.category
      FROM team_tags tt
      JOIN tags t ON tt.tag_id = t.id
      WHERE tt.team_id = $1
    `, [teamId]);

    // Construct response
    team.members = membersResult.rows;
    team.tags = tagsResult.rows;

    res.status(200).json({
      success: true,
      data: team
    });
  } catch (error) {
    console.error('Database error while fetching team:', error); // More specific message
    res.status(500).json({
      success: false,
      message: 'Database error while fetching team details', // More specific message
      error: error.message
    });
  }
};

const getUserTeams = async (req, res) => {
  try {
    // Use the authenticated user's ID from the token
    const userId = req.user.id;

    const teamsResult = await db.pool.query(`
      SELECT t.*, 
      COUNT(tm.id) AS members_count
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = $1 AND t.archived_at IS NULL
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `, [userId]);

    res.status(200).json({
      success: true,
      data: teamsResult.rows
    });
  } catch (error) {
    console.error('Database error while fetching user teams:', error); // More specific message
    res.status(500).json({
      success: false,
      message: 'Database error while fetching user teams', // More specific message
      error: error.message
    });
  }
};

const getUserRoleInTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.params.userId;
    
    const roleResult = await db.pool.query(`
      SELECT role 
      FROM team_members 
      WHERE team_id = $1 AND user_id = $2
    `, [teamId, userId]);
    
    if (roleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User is not a member of this team'
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        role: roleResult.rows[0].role
      }
    });
  } catch (error) {
    console.error('Error fetching user role:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user role',
      error: error.message
    });
  }
};


const updateTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Check if team exists and user is the creator
    const teamCheck = await db.pool.query(`
      SELECT t.*, tm.role
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE t.id = $1 
      AND tm.user_id = $2 
      AND tm.role = 'creator'
      AND t.archived_at IS NULL
    `, [teamId, userId]);

    if (teamCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this team or team not found'
      });
    }

    // Create validation schema for update (similar to creation but all fields optional)
    const updateSchema = Joi.object({
      name: Joi.string().min(3).max(100),
      description: Joi.string().min(10).max(500),
      is_public: Joi.boolean(),
      max_members: Joi.number().min(2).max(20),
      postal_code: Joi.string(),
      status: Joi.string().valid('active', 'inactive'),
      tags: Joi.array().items(Joi.object({
        tag_id: Joi.number().integer().required(),
      }))
    });

    // Validate request body
    const { error, value } = updateSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input data', // More specific message
        errors: error.details.map(detail => detail.message)
      });
    }

    // Begin transaction
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // Build dynamic update query
      const updateFields = [];
      const queryParams = [];
      let paramCounter = 1;

      if (value.name) {
        updateFields.push(`name = $${paramCounter}`);
        queryParams.push(value.name);
        paramCounter++;
      }

      if (value.description) {
        updateFields.push(`description = $${paramCounter}`);
        queryParams.push(value.description);
        paramCounter++;
      }

      if (value.is_public !== undefined) {
        updateFields.push(`is_public = $${paramCounter}`);
        queryParams.push(value.is_public);
        paramCounter++;
      }

      if (value.max_members) {
        updateFields.push(`max_members = $${paramCounter}`);
        queryParams.push(value.max_members);
        paramCounter++;
      }

      if (value.postal_code) {
        updateFields.push(`postal_code = $${paramCounter}`);
        queryParams.push(value.postal_code);
        paramCounter++;
      }

      if (value.status) {
        updateFields.push(`status = $${paramCounter}`);
        queryParams.push(value.status);
        paramCounter++;
      }

      // Only update if there are fields to update
      if (updateFields.length > 0) {
        updateFields.push(`updated_at = NOW()`);

        queryParams.push(teamId); // Add teamId as the last parameter

        const updateQuery = `
          UPDATE teams 
          SET ${updateFields.join(', ')}
          WHERE id = $${paramCounter}
          RETURNING *
        `;

        await client.query(updateQuery, queryParams);
      }

      // Update tags if provided
      if (value.tags && value.tags.length > 0) {
        const tagIdsToCheck = value.tags.map(tag => tag.tag_id);
        const tagsExistResult = await client.query(`
          SELECT id FROM tags WHERE id IN (${tagIdsToCheck.join(',')})
        `);
        const existingTagIds = tagsExistResult.rows.map(row => row.id);

        if (existingTagIds.length !== tagIdsToCheck.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Invalid input data', // More specific message
            errors: ['One or more of the provided tag IDs do not exist.']
          });
        }

        // Remove existing tags
        await client.query(`
          DELETE FROM team_tags WHERE team_id = $1
        `, [teamId]);

        // Add new tags
        const tagInserts = value.tags.map(tag =>
          client.query(`
            INSERT INTO team_tags (team_id, tag_id)
            VALUES ($1, $2)
          `, [teamId, tag.tag_id])
        );

        await Promise.all(tagInserts);
      }

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Team updated successfully'
      });
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error('Database error during team update:', dbError); // More specific message
      res.status(500).json({
        success: false,
        message: 'Database error while updating team', // More specific message
        errorDetails: dbError.message,
        fullError: dbError
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Team update error:', error);
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
    const userId = req.user.id;

    // Check if team exists and user is the creator
    const teamCheck = await db.pool.query(`
      SELECT t.*, tm.role
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE t.id = $1 
      AND tm.user_id = $2 
      AND tm.role = 'creator'
      AND t.archived_at IS NULL
    `, [teamId, userId]);

    if (teamCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this team or team not found'
      });
    }

    // Begin transaction
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // Soft delete by setting archived_at
      await client.query(`
        UPDATE teams
        SET archived_at = NOW(), status = 'inactive'
        WHERE id = $1
      `, [teamId]);

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Team archived successfully'
      });
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error('Database error during team deletion:', dbError); // More specific message
      res.status(500).json({
        success: false,
        message: 'Database error while deleting team', // More specific message
        errorDetails: dbError.message,
        fullError: dbError
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Team deletion error:', error);
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
    const userId = req.user.id;

    // Validate request body
    const schema = Joi.object({
      memberId: Joi.number().required(),
      role: Joi.string().valid('member', 'admin').default('member')
    });

    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input data', // More specific message
        errors: error.details.map(detail => detail.message)
      });
    }

    const newMemberId = value.memberId;
    const role = value.role;

    // Check if the user making the request is authorized (creator or admin)
    const authCheck = await db.pool.query(`
      SELECT tm.role 
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.team_id = $1 
      AND tm.user_id = $2
      AND (tm.role = 'creator' OR tm.role = 'admin')
      AND t.archived_at IS NULL
    `, [teamId, userId]);

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to add members to this team'
      });
    }

    // Check if team exists and isn't full
    const teamCheck = await db.pool.query(`
      SELECT t.max_members, COUNT(tm.id) AS current_members
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      WHERE t.id = $1 AND t.archived_at IS NULL
      GROUP BY t.id, t.max_members
    `, [teamId]);

    if (teamCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    if (teamCheck.rows[0].current_members >= teamCheck.rows[0].max_members) {
      return res.status(400).json({
        success: false,
        message: 'Team is already at maximum capacity'
      });
    }

    // Check if user exists
    const userCheck = await db.pool.query(`
      SELECT id FROM users WHERE id = $1
    `, [newMemberId]);

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is already a member
    const memberCheck = await db.pool.query(`
      SELECT id FROM team_members 
      WHERE team_id = $1 AND user_id = $2
    `, [teamId, newMemberId]);

    if (memberCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User is already a member of this team'
      });
    }

    // Add member
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(`
        INSERT INTO team_members (team_id, user_id, role)
        VALUES ($1, $2, $3)
      `, [teamId, newMemberId, role]);

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Member added successfully'
      });
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error('Database error while adding member:', dbError); // More specific message
      res.status(500).json({
        success: false,
        message: 'Database error while adding team member', // More specific message
        errorDetails: dbError.message,
        fullError: dbError
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Add team member error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding team member',
      error: error.message
    });
  }
};

const removeTeamMember = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const memberId = req.params.memberId;
    const userId = req.user.id;

    // Check if the user making the request is authorized (creator, admin, or self-removal)
    const authCheck = await db.pool.query(`
      SELECT tm.role 
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.team_id = $1 
      AND tm.user_id = $2
      AND t.archived_at IS NULL
    `, [teamId, userId]);

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to remove members from this team'
      });
    }

    const userRole = authCheck.rows[0].role;
    const isSelfRemoval = userId == memberId;

    // Only creators/admins can remove others, anyone can remove themselves
    if (!isSelfRemoval && userRole !== 'creator' && userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to remove other members'
      });
    }

    // Check if target member exists and get their role
    const memberCheck = await db.pool.query(`
      SELECT role FROM team_members 
      WHERE team_id = $1 AND user_id = $2
    `, [teamId, memberId]);

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Member not found in this team'
      });
    }

    const memberRole = memberCheck.rows[0].role;

    // Only creators can remove other creators or admins
    if ((memberRole === 'creator' || memberRole === 'admin') && userRole !== 'creator') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to remove team administrators'
      });
    }

    // Prevent removing the last creator
    if (memberRole === 'creator') {
      const creatorCount = await db.pool.query(`
        SELECT COUNT(*) FROM team_members
        WHERE team_id = $1 AND role = 'creator'
      `, [teamId]);

      if (parseInt(creatorCount.rows[0].count) <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot remove the last team creator. Transfer ownership first.'
        });
      }
    }

    // Remove member
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(`
        DELETE FROM team_members
        WHERE team_id = $1 AND user_id = $2
      `, [teamId, memberId]);

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Member removed successfully'
      });
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error('Database error while removing member:', dbError); // More specific message
      res.status(500).json({
        success: false,
        message: 'Database error while removing team member', // More specific message
        errorDetails: dbError.message,
        fullError: dbError
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Remove team member error:', error);
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
  getUserTeams,
  getUserRoleInTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember
};