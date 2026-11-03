const Shelter = require("../models/Shelter");

// GET /api/shelters
exports.getAllShelters = async (req, res, next) => {
  try {
    const shelters = await Shelter.find({ isActive: true }).lean();
    res.json({ success: true, count: shelters.length, shelters });
  } catch (err) {
    next(err);
  }
};

// GET /api/shelters/:id
exports.getShelterById = async (req, res, next) => {
  try {
    const shelter = await Shelter.findById(req.params.id);
    if (!shelter) {
      return res.status(404).json({ success: false, message: "Shelter not found" });
    }
    res.json({ success: true, shelter });
  } catch (err) {
    next(err);
  }
};

// POST /api/shelters — admin only
exports.createShelter = async (req, res, next) => {
  try {
    const shelter = await Shelter.create(req.body);
    res.status(201).json({ success: true, shelter });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/shelters/:id — admin only
exports.updateShelter = async (req, res, next) => {
  try {
    const shelter = await Shelter.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!shelter) return res.status(404).json({ success: false, message: "Shelter not found" });
    res.json({ success: true, shelter });
  } catch (err) {
    next(err);
  }
};
