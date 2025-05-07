const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// GET /api/tags/structured
router.get('/structured', async (req, res) => {
  try {
    const supercategoryQuery = `
      SELECT DISTINCT supercategory as name
      FROM tags
      WHERE supercategory IS NOT NULL
      ORDER BY supercategory
    `;
    const supercategoryResult = await db.query(supercategoryQuery);

    const structuredData = [];

    for (const supercat of supercategoryResult.rows) {
      const supercategory = {
        id: supercat.name,
        name: supercat.name,
        categories: []
      };

      const categoryQuery = `
        SELECT DISTINCT category as name
        FROM tags
        WHERE supercategory = $1
        ORDER BY category
      `;
      const categoryResult = await db.query(categoryQuery, [supercat.name]);

      for (const cat of categoryResult.rows) {
        const category = {
          id: cat.name,
          name: cat.name,
          tags: []
        };

        const tagsQuery = `
          SELECT id, name
          FROM tags
          WHERE category = $1 AND supercategory = $2
          ORDER BY name
        `;
        const tagsResult = await db.query(tagsQuery, [cat.name, supercat.name]);

        category.tags = tagsResult.rows
          .map(tag => {
            const parsedId = parseInt(tag.id, 10);
            if (isNaN(parsedId)) return null; // Filter out malformed IDs
            return {
              id: parsedId,
              name: tag.name
            };
          })
          .filter(Boolean); // Remove null entries

        if (category.tags.length > 0) {
          supercategory.categories.push(category);
        }
      }

      if (supercategory.categories.length > 0) {
        structuredData.push(supercategory);
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('Structured tags preview:', JSON.stringify(structuredData, null, 2));
    }

    res.json(structuredData);
  } catch (error) {
    console.error('Error fetching structured tags:', error);
    res.status(500).json({ error: 'Failed to fetch structured tags' });
  }
});

// POST /api/tags/create
router.post('/create', async (req, res) => {
  try {
    const { name, category, supercategory } = req.body;

    const insertQuery = `
      INSERT INTO tags (name, category, supercategory)
      VALUES ($1, $2, $3)
      RETURNING id, name, category, supercategory
    `;
    const result = await db.query(insertQuery, [name, category, supercategory]);

    res.status(201).json({ tag: result.rows[0] });
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

// GET /api/tags/search
router.get('/search', async (req, res) => {
  try {
    const query = req.query.query || '';

    const searchQuery = `
      SELECT id, name, category, supercategory
      FROM tags
      WHERE LOWER(name) LIKE $1
      LIMIT 20
    `;
    const result = await db.query(searchQuery, [`%${query.toLowerCase()}%`]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error searching tags:', error);
    res.status(500).json({ error: 'Failed to search tags' });
  }
});

// PUT /api/tags/users/:userId
router.put('/users/:userId/tags', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { tags } = req.body; 

    if (!Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({ error: 'Tags must be a non-empty array' });
    }

    const deleteQuery = `
      DELETE FROM user_tags WHERE user_id = $1
    `;
    await db.query(deleteQuery, [userId]);

    const insertQuery = `
      INSERT INTO user_tags (user_id, tag_id)
      VALUES ($1, $2)
      RETURNING user_id, tag_id
    `;
    
    for (const tagId of tags) {
      await db.query(insertQuery, [userId, tagId]);
    }

    res.status(200).json({ message: 'User tags updated successfully' });
  } catch (error) {
    console.error('Error updating user tags:', error);
    res.status(500).json({ error: 'Failed to update user tags' });
  }
});

module.exports = router;