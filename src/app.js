const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS Configuration (Modified)
const corsOptions = {
  origin: 'http://localhost:5173', // Replace with your frontend's URL!
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: 'Content-Type,Authorization',
};

app.use(cors(corsOptions));

// Routes
const tagRoutes = require('./routes/api/tags');
app.use('/api/tags', tagRoutes);

try {
  const routes = require('./routes');
  app.use('/api', routes);
} catch (error) {
  console.error('Routes import error:', error);
  console.error('Error name:', error.name);
  console.error('Error message:', error.message);
  console.error('Error stack:', error.stack);
}

// Home route
app.get('/', (req, res) => {
  res.send('Lomir API is running...');
});

// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

module.exports = app;