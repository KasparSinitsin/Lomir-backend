const express = require("express");
const router = express.Router();
const contactController = require("../controllers/contactController");
const { contactLimiter } = require("../middlewares/rateLimiter");

router.post("/", contactLimiter, contactController.submitContactForm);

module.exports = router;
