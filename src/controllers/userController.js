const db = require('../config/database');

const getAllUsers = async (req, res) => {
    try {
      // Placeholder response
      res.status(200).json({
        success: true,
        message: 'Get all users placeholder',
        data: []
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching users',
        error: error.message
      });
    }
  };
  
const getUserById = async (req, res) => {
    try {
      const userId = req.params.id;
      res.status(200).json({
        success: true,
        message: `Get user ${userId} placeholder`,
        data: { id: userId, username: 'sampleuser' }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching user',
        error: error.message
      });
    }
  };
  
const updateUser = async (req, res) => {
    try {
      const userId = req.params.id;
      res.status(200).json({
        success: true,
        message: `Update user ${userId} placeholder`,
        data: { id: userId }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error updating user',
        error: error.message
      });
    }
  };
  
const deleteUser = async (req, res) => {
    try {
      const userId = req.params.id;
      res.status(200).json({
        success: true,
        message: `Delete user ${userId} placeholder`,
        data: { id: userId }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error deleting user',
        error: error.message
      });
    }
  };
  
const getUserTeams = async (req, res) => {
    try {
      const userId = req.params.id;
      res.status(200).json({
        success: true,
        message: `Get teams for user ${userId} placeholder`,
        data: []
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching user teams',
        error: error.message
      });
    }
  };

const getUserTags = async (req, res) => {
  try {
    const userId = req.params.id;
    
    const tagsResult = await db.query(`
      SELECT t.id, t.name, t.category, t.supercategory 
      FROM tags t
      JOIN user_tags ut ON t.id = ut.tag_id
      WHERE ut.user_id = $1
    `, [userId]);

    res.status(200).json({
      success: true,
      data: tagsResult.rows
    });
  } catch (error) {
    console.error('Error fetching user tags:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user tags',
      error: error.message
    });
  }
};

const updateUserTags = async (req, res) => {
  const userId = req.params.id;
  const { tags } = req.body;

  // Input validation: Ensure tags is an array and each tag has a valid tag_id
  if (!Array.isArray(tags) || tags.some(tag => !tag.tag_id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid tag data provided'
    });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Remove existing user tags before inserting new ones
    await client.query('DELETE FROM user_tags WHERE user_id = $1', [userId]);

    // Insert new tags if provided
    if (tags.length > 0) {
      const tagInserts = tags.map(tag =>
        client.query(`
          INSERT INTO user_tags (user_id, tag_id)
          VALUES ($1, $2)
        `, [userId, tag.tag_id])
      );
      await Promise.all(tagInserts);  // Execute all insertions in parallel
    }

    await client.query('COMMIT');
    res.status(200).json({
      success: true,
      message: 'User tags updated successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user tags:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user tags',
      error: error.message
    });
  } finally {
    client.release();  // Always release the client after use
  }
};
  
module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserTeams,
  getUserTags,
  updateUserTags
};