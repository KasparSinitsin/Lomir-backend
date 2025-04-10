const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// *** Middleware (Order is important!) ***

// 1. Body Parsers (for JSON and URL-encoded data)
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// 2. multer (for multipart/form-data)
// const upload = multer({ dest: 'uploads/' }); // Configure multer (temporary upload dir)
// app.use(upload.none()); // Parse text fields only (no files) - OR - app.use(multer().any()); // Parse all fields (text and files)

// 3. (Optional) Raw Body Parsing (for debugging)
// app.use((req, res, next) => {
//   if (req.headers['content-type'] && req.headers['content-type'].startsWith('multipart/form-data')) {
//     // Only parse raw body for multipart/form-data
//     rawBody(req, {
//       length: req.headers['content-length'],
//       limit: '1mb', // Adjust limit as needed
//       encoding: req.charset || 'utf-8'
//     }, (err, string) => {
//       if (err) {
//         console.error('Error getting raw body:', err);
//         req.rawBody = ''; // Or handle the error appropriately
//       } else {
//         req.rawBody = string;
//       }
//       next();
//     });
//   } else {
//     req.rawBody = ''; // No raw body for other content types
//     next();
//   }
// });

// CORS Configuration
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const corsOptions = {
  origin: frontendOrigin,
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type,Authorization',
};
app.use(cors(corsOptions));

// *** Routes ***
const tagRoutes = require('./routes/api/tags');
app.use('/api/tags', tagRoutes);

try {
  const routes = require('./routes');
  app.use('/api', routes);
} catch (error) {
  console.error('Routes import error:', error);
}

// Home route (optional)
app.get('/', (req, res) => {
  res.send('Lomir API is running...');
});

// *** Error Handling Middleware (Last middleware) ***
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err); // Log the full error
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack, // Don't send stack in production
  });
});

module.exports = app;