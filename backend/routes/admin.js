const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const {
  getAllEmergencies,
  getAdminStats,
  getRescueTeams,
  assignRescueTeam,
  getTeamRecommendations,
  updateEmergencyStatus,
} = require("../controllers/adminController");
const { analyzeSeverity } = require("../controllers/severityController");
const { findSimilarEarthquakes } = require("../controllers/similarityController");

router.use(protect, authorize("admin"));

router.get("/emergencies", getAllEmergencies);
router.get("/stats", getAdminStats);
router.get("/rescue-teams", getRescueTeams);
router.get("/emergencies/:id/recommendations", getTeamRecommendations);
router.patch("/emergencies/:id/assign", assignRescueTeam);
router.patch("/emergencies/:id/status", updateEmergencyStatus);
// Advisory ML severity analysis (read-only). Inherits protect + authorize("admin") from above.
router.post("/emergencies/:id/severity", analyzeSeverity);
// Historical earthquake similarity (KNN, read-only, informational). Same admin-only guard as above.
router.post("/emergencies/:id/similar-earthquakes", findSimilarEarthquakes);

module.exports = router;
