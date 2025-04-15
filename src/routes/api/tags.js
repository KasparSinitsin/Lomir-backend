const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// GET /api/tags/structured
router.get('/structured', async (req, res) => {
  try {
    // Query all supercategories
    const supercategoryQuery = `
      SELECT DISTINCT supercategory as name
      FROM tags
      WHERE supercategory IS NOT NULL
      ORDER BY supercategory
    `;
    const supercategoryResult = await db.query(supercategoryQuery);
    
    // Build the structured response
    const structuredData = [];
    
    for (const supercat of supercategoryResult.rows) {
      // Create supercategory object
      const supercategory = {
        id: supercat.name, // Using name as ID for supercategory
        name: supercat.name,
        categories: []
      };
      
      // Get categories for this supercategory
      const categoryQuery = `
        SELECT DISTINCT category as name
        FROM tags
        WHERE supercategory = $1
        ORDER BY category
      `;
      const categoryResult = await db.query(categoryQuery, [supercat.name]);
      
      for (const cat of categoryResult.rows) {
        const category = {
          id: cat.name, // Using name as ID for category
          name: cat.name,
          tags: []
        };
        
        // Get tags for this category with their REAL database IDs
        const tagsQuery = `
          SELECT id, name
          FROM tags
          WHERE category = $1 AND supercategory = $2
          ORDER BY name
        `;
        const tagsResult = await db.query(tagsQuery, [cat.name, supercat.name]);
        
        category.tags = tagsResult.rows.map(tag => ({
          id: tag.id,  // Use the actual numeric ID from the database
          name: tag.name
        }));
        
        // Only add categories that have tags
        if (category.tags.length > 0) {
          supercategory.categories.push(category);
        }
      }
      
      // Only add supercategories that have categories with tags
      if (supercategory.categories.length > 0) {
        structuredData.push(supercategory);
      }
    }
    
    console.log('Structured tags:', JSON.stringify(structuredData, null, 2));
    res.json(structuredData);
  } catch (error) {
    console.error('Error fetching structured tags:', error);
    res.status(500).json({ error: 'Failed to fetch structured tags' });
  }
});

// POST /api/tags/create
router.post('/create', async (req, res) => {
  try {
    // Simply return the tag data with an id for now
    const newTag = {
      id: Math.floor(Math.random() * 1000) + 100, // Random ID for development
      name: req.body.name,
      category: req.body.category,
      supercategory: req.body.supercategory
    };
    
    res.status(201).json({ tag: newTag });
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

// GET /api/tags/search
router.get('/search', async (req, res) => {
  try {
    const query = req.query.query || '';
    
    // Mock search results
    const searchResults = [
      { id: 1, name: "JavaScript", category: "Software Development", supercategory: "Technology & Development" },
      { id: 2, name: "React", category: "Software Development", supercategory: "Technology & Development" }
    ].filter(tag => tag.name.toLowerCase().includes(query.toLowerCase()));
    
    res.json(searchResults);
  } catch (error) {
    console.error('Error searching tags:', error);
    res.status(500).json({ error: 'Failed to search tags' });
  }
});

module.exports = router;