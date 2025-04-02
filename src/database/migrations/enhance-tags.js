const enhanceTagsTable = require('./10_enhance_tags_table');

const runEnhancement = async () => {
  try {
    console.log('Running tag table enhancement...');
    await enhanceTagsTable();
    console.log('Tag enhancement completed successfully!');
  } catch (error) {
    console.error('Error enhancing tags table:', error);
  } finally {
    process.exit();
  }
};

runEnhancement();