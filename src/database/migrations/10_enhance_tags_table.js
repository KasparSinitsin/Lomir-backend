const db = require('../../config/database');

const enhanceTagsTable = async () => {
  try {
    // Step 1: Add new columns to the tags table
    await db.query(`
      ALTER TABLE tags 
      ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES tags(id),
      ADD COLUMN IF NOT EXISTS supercategory VARCHAR(255),
      ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'approved',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);
    
    // Step 2: Update existing tags to be system tags
    await db.query(`
      UPDATE tags
      SET is_system = TRUE, status = 'approved'
      WHERE is_system IS NULL
    `);

    // Step 3: Define the mapping of tags to categories and supercategories
    const tagCategoryMap = {
      // Technology & Development
      "JavaScript": { category: "Software Development", supercategory: "Technology & Development" },
      "React": { category: "Software Development", supercategory: "Technology & Development" },
      "Node.js": { category: "Software Development", supercategory: "Technology & Development" },
      "Python": { category: "Software Development", supercategory: "Technology & Development" },
      "Java": { category: "Software Development", supercategory: "Technology & Development" },
      "C++": { category: "Software Development", supercategory: "Technology & Development" },
      "Angular": { category: "Software Development", supercategory: "Technology & Development" },
      "HTML/CSS": { category: "Software Development", supercategory: "Technology & Development" },
      "Front-end Development": { category: "Software Development", supercategory: "Technology & Development" },
      "Mobile App Development": { category: "Software Development", supercategory: "Technology & Development" },
      "Mobile Development": { category: "Software Development", supercategory: "Technology & Development" },
      "Web Development": { category: "Software Development", supercategory: "Technology & Development" },
      "Database Design": { category: "Software Development", supercategory: "Technology & Development" },
      "Database Management": { category: "Software Development", supercategory: "Technology & Development" },
      "DevOps": { category: "Software Development", supercategory: "Technology & Development" },
      "Flutter": { category: "Software Development", supercategory: "Technology & Development" },
      "GraphQL": { category: "Software Development", supercategory: "Technology & Development" },
      
      "3D Printing": { category: "Hardware & Engineering", supercategory: "Technology & Development" },
      "Arduino Projects": { category: "Hardware & Engineering", supercategory: "Technology & Development" },
      "Electronics Repair": { category: "Hardware & Engineering", supercategory: "Technology & Development" },
      "Robotics": { category: "Hardware & Engineering", supercategory: "Technology & Development" },
      "IoT": { category: "Hardware & Engineering", supercategory: "Technology & Development" },
      "Hardware": { category: "Hardware & Engineering", supercategory: "Technology & Development" },
      
      "AI/ML": { category: "AI & Data Science", supercategory: "Technology & Development" },
      
      // Creative Arts
      "Art": { category: "Visual Arts", supercategory: "Creative Arts" },
      "Oil Painting": { category: "Visual Arts", supercategory: "Creative Arts" },
      "Digital Illustration": { category: "Visual Arts", supercategory: "Creative Arts" },
      "Photography": { category: "Visual Arts", supercategory: "Creative Arts" },
      "Sculpture": { category: "Visual Arts", supercategory: "Creative Arts" },
      
      "Acting": { category: "Performance Arts", supercategory: "Creative Arts" },
      "Dance": { category: "Performance Arts", supercategory: "Creative Arts" },
      "Public Speaking": { category: "Performance Arts", supercategory: "Creative Arts" },
      "Improv Comedy": { category: "Performance Arts", supercategory: "Creative Arts" },
      "Ballet": { category: "Performance Arts", supercategory: "Creative Arts" },
      
      "Reading": { category: "Writing & Literature", supercategory: "Creative Arts" },
      "Content Creation": { category: "Writing & Literature", supercategory: "Creative Arts" },
      
      "Crafts & DIY": { category: "Crafts & DIY", supercategory: "Creative Arts" },
      
      // Music
      "Music": { category: "Music", supercategory: "Music" },
      "Piano": { category: "Instruments", supercategory: "Music" },
      "Guitar": { category: "Instruments", supercategory: "Music" },
      "Drums": { category: "Instruments", supercategory: "Music" },
      "Violin": { category: "Instruments", supercategory: "Music" },
      "Jazz Piano": { category: "Instruments", supercategory: "Music" },
      "Classical Guitar": { category: "Instruments", supercategory: "Music" },
      
      "Singing": { category: "Vocal", supercategory: "Music" },
      "Choir": { category: "Vocal", supercategory: "Music" },
      "Choir Singing": { category: "Vocal", supercategory: "Music" },
      "Voice Training": { category: "Vocal", supercategory: "Music" },
      
      "Audio Mixing": { category: "Production", supercategory: "Music" },
      "Music Composition": { category: "Production", supercategory: "Music" },
      "Electronic Music Production": { category: "Production", supercategory: "Music" },
      
      // Sports & Fitness
      "Sports": { category: "Sports", supercategory: "Sports & Fitness" },
      
      "Soccer": { category: "Team Sports", supercategory: "Sports & Fitness" },
      "Basketball": { category: "Team Sports", supercategory: "Sports & Fitness" },
      "Volleyball": { category: "Team Sports", supercategory: "Sports & Fitness" },
      "Basketball Strategy": { category: "Team Sports", supercategory: "Sports & Fitness" },
      "Soccer Coaching": { category: "Team Sports", supercategory: "Sports & Fitness" },
      "Volleyball Skills": { category: "Team Sports", supercategory: "Sports & Fitness" },
      
      "Running": { category: "Individual Sports", supercategory: "Sports & Fitness" },
      "Swimming": { category: "Individual Sports", supercategory: "Sports & Fitness" },
      "Tennis": { category: "Individual Sports", supercategory: "Sports & Fitness" },
      "Marathon Training": { category: "Individual Sports", supercategory: "Sports & Fitness" },
      "Rock Climbing": { category: "Individual Sports", supercategory: "Sports & Fitness" },
      "Yoga Instruction": { category: "Individual Sports", supercategory: "Sports & Fitness" },
      "Swimming Techniques": { category: "Individual Sports", supercategory: "Sports & Fitness" },
      
      "Outdoor Activities": { category: "Outdoor Activities", supercategory: "Sports & Fitness" },
      
      // Languages
      "Languages": { category: "Languages", supercategory: "Languages" },
      
      "Spanish": { category: "European Languages", supercategory: "Languages" },
      "French": { category: "European Languages", supercategory: "Languages" },
      "German": { category: "European Languages", supercategory: "Languages" },
      "Italian": { category: "European Languages", supercategory: "Languages" },
      
      "Mandarin": { category: "Asian Languages", supercategory: "Languages" },
      "Japanese": { category: "Asian Languages", supercategory: "Languages" },
      "Korean": { category: "Asian Languages", supercategory: "Languages" },
      
      // Business & Entrepreneurship
      "Business & Entrepreneurship": { category: "Business", supercategory: "Business & Entrepreneurship" },
      
      "Web App": { category: "Project Types", supercategory: "Business & Entrepreneurship" },
      "Mobile App": { category: "Project Types", supercategory: "Business & Entrepreneurship" },
      "Startup": { category: "Project Types", supercategory: "Business & Entrepreneurship" },
      "Open Source": { category: "Project Types", supercategory: "Business & Entrepreneurship" },
      "E-commerce": { category: "Project Types", supercategory: "Business & Entrepreneurship" },
      "Educational": { category: "Project Types", supercategory: "Business & Entrepreneurship" },
      "Game Development": { category: "Project Types", supercategory: "Business & Entrepreneurship" },
      
      "Digital Marketing": { category: "Marketing", supercategory: "Business & Entrepreneurship" },
      "Social Media Strategy": { category: "Marketing", supercategory: "Business & Entrepreneurship" },
      "SEO Optimization": { category: "Marketing", supercategory: "Business & Entrepreneurship" },
      "UX Design": { category: "Marketing", supercategory: "Business & Entrepreneurship" },
      
      "Investing": { category: "Finance", supercategory: "Business & Entrepreneurship" },
      "Accounting": { category: "Finance", supercategory: "Business & Entrepreneurship" },
      "Investment Analysis": { category: "Finance", supercategory: "Business & Entrepreneurship" },
      "Cryptocurrency Trading": { category: "Finance", supercategory: "Business & Entrepreneurship" },
      "Budget Planning": { category: "Finance", supercategory: "Business & Entrepreneurship" },
      
      "Social Impact": { category: "Social Impact", supercategory: "Business & Entrepreneurship" },
      
      // Wellness & Lifestyle
      "Health & Wellness": { category: "Health & Wellness", supercategory: "Wellness & Lifestyle" },
      
      "Nutrition": { category: "Health & Wellness", supercategory: "Wellness & Lifestyle" },
      "Healthy Cooking": { category: "Health & Wellness", supercategory: "Wellness & Lifestyle" },
      "Vegan Cooking": { category: "Health & Wellness", supercategory: "Wellness & Lifestyle" },
      "Meal Prep": { category: "Health & Wellness", supercategory: "Wellness & Lifestyle" },
      
      "Meditation": { category: "Mindfulness", supercategory: "Wellness & Lifestyle" },
      "Yoga": { category: "Mindfulness", supercategory: "Wellness & Lifestyle" },
      "Meditation Practice": { category: "Mindfulness", supercategory: "Wellness & Lifestyle" },
      "Stress Management": { category: "Mindfulness", supercategory: "Wellness & Lifestyle" },
      "Work-Life Balance": { category: "Mindfulness", supercategory: "Wellness & Lifestyle" },
      
      "Travel": { category: "Lifestyle", supercategory: "Wellness & Lifestyle" },
      "Cooking": { category: "Lifestyle", supercategory: "Wellness & Lifestyle" },
      "Gaming": { category: "Lifestyle", supercategory: "Wellness & Lifestyle" },
      "Sustainability": { category: "Lifestyle", supercategory: "Wellness & Lifestyle" },
      
      // Science & Learning
      "Science & Learning": { category: "Science & Learning", supercategory: "Science & Learning" },
      
      "Physics": { category: "Natural Sciences", supercategory: "Science & Learning" },
      "Biology": { category: "Natural Sciences", supercategory: "Science & Learning" },
      "Astronomy Observation": { category: "Natural Sciences", supercategory: "Science & Learning" },
      "Wildlife Conservation": { category: "Natural Sciences", supercategory: "Science & Learning" },
      "Botany": { category: "Natural Sciences", supercategory: "Science & Learning" },
      
      "Psychology": { category: "Social Sciences", supercategory: "Science & Learning" },
      "Economics": { category: "Social Sciences", supercategory: "Science & Learning" },
      "Psychology Research": { category: "Social Sciences", supercategory: "Science & Learning" },
      "Urban Planning": { category: "Social Sciences", supercategory: "Science & Learning" },
      "Archaeological Fieldwork": { category: "Social Sciences", supercategory: "Science & Learning" }
    };

    // Step 4: Update each tag with its new category and supercategory
    console.log('Updating tag categories and supercategories...');
    
    // Get all existing tags
    const tagsResult = await db.query(`SELECT id, name FROM tags`);
    const tags = tagsResult.rows;
    
    let updateCount = 0;
    let skipCount = 0;
    
    for (const tag of tags) {
      const mapping = tagCategoryMap[tag.name];
      
      if (mapping) {
        await db.query(`
          UPDATE tags
          SET category = $1, supercategory = $2
          WHERE id = $3
        `, [mapping.category, mapping.supercategory, tag.id]);
        
        console.log(`Updated tag "${tag.name}" to category "${mapping.category}" and supercategory "${mapping.supercategory}"`);
        updateCount++;
      } else {
        console.log(`No mapping found for tag "${tag.name}", skipping`);
        skipCount++;
      }
    }

    // Step 5: Add any missing categories or supercategories as tags
    const allCategories = new Set();
    const allSupercategories = new Set();
    
    Object.values(tagCategoryMap).forEach(mapping => {
      allCategories.add(mapping.category);
      allSupercategories.add(mapping.supercategory);
    });
    
    let categoryCount = 0;
    for (const category of allCategories) {
      const exists = await db.query(`
        SELECT COUNT(*) FROM tags WHERE name = $1
      `, [category]);
      
      if (parseInt(exists.rows[0].count) === 0) {
        // Find which supercategory this category belongs to
        let supercategory = null;
        for (const [tagName, mapping] of Object.entries(tagCategoryMap)) {
          if (mapping.category === category) {
            supercategory = mapping.supercategory;
            break;
          }
        }
        
        if (supercategory) {
          await db.query(`
            INSERT INTO tags (name, category, supercategory, is_system, status)
            VALUES ($1, $2, $3, TRUE, 'approved')
          `, [category, category, supercategory]);
          
          console.log(`Added missing category "${category}" with supercategory "${supercategory}"`);
          categoryCount++;
        }
      }
    }
    
    let supercategoryCount = 0;
    for (const supercategory of allSupercategories) {
      const exists = await db.query(`
        SELECT COUNT(*) FROM tags WHERE name = $1
      `, [supercategory]);
      
      if (parseInt(exists.rows[0].count) === 0) {
        await db.query(`
          INSERT INTO tags (name, category, supercategory, is_system, status)
          VALUES ($1, $2, $2, TRUE, 'approved')
        `, [supercategory, supercategory]);
        
        console.log(`Added missing supercategory "${supercategory}"`);
        supercategoryCount++;
      }
    }

    // Step 6: Update parent_id relationships based on the new hierarchy
    console.log('Updating tag hierarchy relationships...');
    
    // Get all tags with their categories and supercategories
    const allTagsResult = await db.query(`
      SELECT id, name, category, supercategory 
      FROM tags
    `);
    const allTags = allTagsResult.rows;
    
    // Create lookup maps for categories and supercategories
    const categoryIdMap = {};
    const supercategoryIdMap = {};
    
    allTags.forEach(tag => {
      if (tag.name === tag.category) {
        categoryIdMap[tag.category] = tag.id;
      }
      
      if (tag.name === tag.supercategory) {
        supercategoryIdMap[tag.supercategory] = tag.id;
      }
    });
    
    // Set parent_id for tags to point to their category
    for (const tag of allTags) {
      // Skip supercategory and category tags themselves
      if (tag.name === tag.supercategory || tag.name === tag.category) {
        continue;
      }
      
      // Regular tags should have their category as parent
      const categoryId = categoryIdMap[tag.category];
      if (categoryId) {
        await db.query(`
          UPDATE tags 
          SET parent_id = $1 
          WHERE id = $2
        `, [categoryId, tag.id]);
      }
    }
    
    // Set parent_id for category tags to point to their supercategory
    for (const category of Object.keys(categoryIdMap)) {
      const categoryId = categoryIdMap[category];
      
      // Find the supercategory for this category
      const categoryTag = allTags.find(tag => tag.id === categoryId);
      if (categoryTag && categoryTag.supercategory) {
        const supercategoryId = supercategoryIdMap[categoryTag.supercategory];
        if (supercategoryId) {
          await db.query(`
            UPDATE tags 
            SET parent_id = $1 
            WHERE id = $2
          `, [supercategoryId, categoryId]);
        }
      }
    }

    console.log(`Tags table enhancement complete:
- Added columns for user-generated tags support
- Updated ${updateCount} tags with new categories and supercategories
- Skipped ${skipCount} tags with no mapping
- Added ${categoryCount} missing categories
- Added ${supercategoryCount} missing supercategories
- Updated parent-child relationships for tag hierarchy`);
  } catch (error) {
    console.error('Error enhancing tags table:', error);
    throw error;
  }
};

module.exports = enhanceTagsTable;