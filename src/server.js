const app = require('./app');
const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

const searchRoutes = require('./routes/searchRoutes');

// Make sure that the routes are properly used in your app
app.use('/search', searchRoutes);