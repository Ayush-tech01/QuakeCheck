const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const {
  getAllShelters,
  getShelterById,
  createShelter,
  updateShelter,
} = require("../controllers/shelterController");

router.get("/", getAllShelters);
router.get("/:id", getShelterById);
router.post("/", protect, authorize("admin"), createShelter);
router.patch("/:id", protect, authorize("admin"), updateShelter);

module.exports = router;
