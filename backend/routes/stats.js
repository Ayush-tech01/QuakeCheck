const express = require("express");
const router = express.Router();
const { getRescueTeamSummary } = require("../controllers/statsController");

// Public, read-only aggregate counts for the homepage.
router.get("/rescue-teams", getRescueTeamSummary);

module.exports = router;
