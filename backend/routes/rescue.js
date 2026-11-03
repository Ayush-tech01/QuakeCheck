const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const {
  getAssignedEmergencies,
  markEnRoute,
  completeRescue,
  updateLocation,
} = require("../controllers/rescueController");

router.use(protect, authorize("rescue_team"));

router.get("/assigned", getAssignedEmergencies);
router.patch("/en-route/:id", markEnRoute);
router.patch("/complete/:id", completeRescue);
router.patch("/location", updateLocation);

module.exports = router;
