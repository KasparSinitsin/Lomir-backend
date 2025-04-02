const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// GET /api/tags/structured
router.get('/structured', async (req, res) => {
  try {
    // Sample structured tag data for development
    const structuredTags = [
      {
        id: 1,
        name: "Technology & Development",
        categories: [
          {
            id: 1,
            name: "Software Development",
            tags: [
              { id: 1, name: "JavaScript" },
              { id: 2, name: "React" },
              { id: 3, name: "Node.js" }
            ]
          },
          {
            id: 2,
            name: "Hardware & Engineering",
            tags: [
              { id: 4, name: "3D Printing" },
              { id: 5, name: "Arduino" }
            ]
          }
        ]
      },
      {
        id: 2,
        name: "Creative Arts",
        categories: [
          {
            id: 3,
            name: "Visual Arts",
            tags: [
              { id: 6, name: "Painting" },
              { id: 7, name: "Photography" }
            ]
          }
        ]
      }
    ];
    
    res.json(structuredTags);
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