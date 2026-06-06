const express = require('express');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const teamRoutes = require('./teamRoutes');
const searchRoutes = require('./searchRoutes');
const badgeRoutes = require('./badgeRoutes');
const messageRoutes = require('./messageRoutes');
const notificationRoutes = require('./notificationRoutes');
const matchingRoutes = require('./matchingRoutes'); 
const imagekitRoutes = require("./imagekitRoutes");
const contactRoutes = require("./contactRoutes");

const tagRoutes = require("./api/tags");
const geocodingRoutes = require("./geocodingRoutes");

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/teams', teamRoutes);
router.use('/search', searchRoutes);
router.use('/badges', badgeRoutes);
router.use('/messages', messageRoutes);
router.use('/notifications', notificationRoutes);
router.use('/matching', matchingRoutes); 
router.use("/imagekit", imagekitRoutes);
router.use("/contact", contactRoutes);
router.use('/tags', tagRoutes);
router.use('/geocoding', geocodingRoutes);

module.exports = router;
