const express = require("express");
const router = express.Router();
const { getEarthquakes, getStats } = require("../controllers/feedController");

router.get("/earthquakes", getEarthquakes);
router.get("/stats", getStats);

module.exports = router;
