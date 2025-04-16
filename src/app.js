const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// *** Middleware***

// Body Parsers
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// CORS Configuration
const allowedOrigins = [
  'https://lomir.onrender.com', 
  'http://localhost:5173',      
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// *** Routes ***
const tagRoutes = require('./routes/api/tags');
app.use('/api/tags', tagRoutes);

try {
  const routes = require('./routes/index');
  app.use('/api', routes);
} catch (error) {
  console.error('Routes import error:', error);
}

// Home route
app.get('/', (req, res) => {
  res.send('Lomir API is running...');
});

// Error Handling
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

module.exports = app;