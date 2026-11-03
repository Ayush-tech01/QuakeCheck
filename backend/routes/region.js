const express = require("express");
const router = express.Router();
const { getRegion } = require("../controllers/regionController");

// Public — the map needs this before a user is necessarily logged in.
router.get("/", getRegion);

module.exports = router;
