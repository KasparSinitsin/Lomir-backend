const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { authenticateToken } = require('../../middlewares/auth');
const { parseLanguage, loadDictionary } = require('../../utils/tagTranslations');
const { tagRelevanceJoinSQL } = require('../../utils/search/tagNameMatch');

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
    res.json(structuredData);
  } catch (error) {
    console.error('Error fetching structured tags:', error);
    res.status(500).json({ error: 'Failed to fetch structured tags' });
  }
});

// GET /api/tags/translations?lang=de
// The translated names of the taxonomy (tags by id, categories and supercategories by their
// English text). English, an unknown language or a missing table give empty maps, status 200:
// the frontend then shows the stored names.
router.get('/translations', async (req, res) => {
  try {
    const dictionary = await loadDictionary(db, parseLanguage(req.query.lang));
    res.set('Cache-Control', 'public, max-age=300');
    res.json(dictionary);
  } catch (error) {
    console.error('Error fetching tag translations:', error);
    res.status(500).json({ error: 'Failed to fetch tag translations' });
  }
});

// POST /api/tags/create
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { name, category, supercategory } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Tag name is required and must be 1-100 characters' });
    }

    const insertQuery = `
      INSERT INTO tags (name, category, supercategory)
      VALUES ($1, $2, $3)
      RETURNING id, name, category, supercategory
    `;
    const result = await db.query(insertQuery, [name.trim(), category, supercategory]);

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

    // Matches the stored name and every translation; best match first.
    const searchQuery = `
      SELECT t.id, t.name, t.category, t.supercategory
      FROM tags t
      ${tagRelevanceJoinSQL('t', '$1')}
      WHERE tm.relevance IS NOT NULL
      ORDER BY tm.relevance ASC, t.name ASC
      LIMIT 20
    `;
    const result = await db.query(searchQuery, [query]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error searching tags:', error);
    res.status(500).json({ error: 'Failed to search tags' });
  }
});

// PUT /api/tags/users/:userId/tags — REMOVED (duplicate of PUT /api/users/:id/tags in userRoutes.js)
// That route already has authenticateToken and owner validation

// GET /api/tags/popular - Get most used tags
router.get('/popular', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const query = `
      SELECT 
        t.id, t.name, t.category, t.supercategory,
        COUNT(ut.user_id) as usage_count
      FROM tags t
      LEFT JOIN user_tags ut ON t.id = ut.tag_id
      GROUP BY t.id, t.name, t.category, t.supercategory
      ORDER BY usage_count DESC, t.name ASC
      LIMIT $1
    `;
    const result = await db.query(query, [limit]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching popular tags:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch popular tags' });
  }
});

// GET /api/tags/suggestions - Smart search with ranking
router.get('/suggestions', async (req, res) => {
  try {
    const query = req.query.query || '';
    const limit = parseInt(req.query.limit) || 10;
    const excludeIds = req.query.exclude ? req.query.exclude.split(',').map(id => parseInt(id)) : [];
    
    const searchQuery = `
      SELECT 
        t.id, t.name, t.category, t.supercategory,
        COUNT(ut.user_id) as usage_count,
        tm.relevance as relevance
      FROM tags t
      ${tagRelevanceJoinSQL('t', '$1')}
      LEFT JOIN user_tags ut ON t.id = ut.tag_id
      WHERE tm.relevance IS NOT NULL
      ${excludeIds.length > 0 ? `AND t.id NOT IN (${excludeIds.join(',')})` : ''}
      GROUP BY t.id, t.name, t.category, t.supercategory, tm.relevance
      ORDER BY relevance ASC, usage_count DESC, t.name ASC
      LIMIT $2
    `;
    const result = await db.query(searchQuery, [query, limit]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching tag suggestions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tag suggestions' });
  }
});

// GET /api/tags/related/:tagId - Get related tags
router.get('/related/:tagId', async (req, res) => {
  try {
    const tagId = parseInt(req.params.tagId);
    const limit = parseInt(req.query.limit) || 5;
    const excludeIds = req.query.exclude ? req.query.exclude.split(',').map(id => parseInt(id)) : [];
    
    const tagInfoQuery = `SELECT category, supercategory FROM tags WHERE id = $1`;
    const tagInfo = await db.query(tagInfoQuery, [tagId]);
    
    if (tagInfo.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tag not found' });
    }
    
    const { category, supercategory } = tagInfo.rows[0];
    const relatedQuery = `
      SELECT 
        t.id, t.name, t.category, t.supercategory,
        COUNT(ut.user_id) as usage_count
      FROM tags t
      LEFT JOIN user_tags ut ON t.id = ut.tag_id
      WHERE (t.category = $2 OR t.supercategory = $3)
        AND t.id != $1
        ${excludeIds.length > 0 ? `AND t.id NOT IN (${excludeIds.join(',')})` : ''}
      GROUP BY t.id, t.name, t.category, t.supercategory
      ORDER BY usage_count DESC, t.name ASC
      LIMIT $4
    `;
    const result = await db.query(relatedQuery, [tagId, category, supercategory, limit]);
    res.json({ success: true, data: result.rows, context: { category, supercategory } });
  } catch (error) {
    console.error('Error fetching related tags:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch related tags' });
  }
});

module.exports = router;
