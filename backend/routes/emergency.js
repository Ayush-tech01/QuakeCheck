const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  markSafe,
  requestRescue,
  getMyEmergencies,
  getEmergencyById,
  getEmergencyTracking,
} = require("../controllers/emergencyController");

router.use(protect);

router.post("/safe", markSafe);
router.post("/rescue", requestRescue);
router.get("/my", getMyEmergencies);
router.get("/:id/tracking", getEmergencyTracking);
router.get("/:id", getEmergencyById);

module.exports = router;
