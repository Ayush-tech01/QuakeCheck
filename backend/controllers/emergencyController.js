const Emergency = require("../models/Emergency");
const Shelter = require("../models/Shelter");
const { getNearestShelterRoute } = require("../services/routingService");
const { isValidCoords, isInsideChandigarh } = require("../utils/geoUtils");
const { buildTrackingSnapshot } = require("../services/trackingService");
const mongoose = require("mongoose");

// Shared response for GPS coordinates that are outside the supported
// Chandigarh operational area. Used by both the "I'm Safe" and rescue-request
// flows so the message and error code stay consistent across the app.
const OUTSIDE_AREA_RESPONSE = {
  success: false,
  code: "OUTSIDE_OPERATIONAL_AREA",
  message:
    "QuakeCheck is currently operational only within Chandigarh, India. Your location appears to be outside the supported area, so we can't route you to a shelter or dispatch a rescue team there yet.",
};

// POST /api/emergency/safe
exports.markSafe = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;

    if (!isValidCoords(lat, lng)) {
      return res.status(400).json({ success: false, message: "Invalid coordinates" });
    }

    if (!isInsideChandigarh(lat, lng)) {
      return res.status(422).json(OUTSIDE_AREA_RESPONSE);
    }

    // Get all available shelters
    const shelters = await Shelter.find({ isActive: true });
    if (shelters.length === 0) {
      return res.status(404).json({ success: false, message: "No shelters available" });
    }

    // Call Python routing service
    let routeData;
    try {
      routeData = await getNearestShelterRoute(lat, lng, shelters);
    } catch (routeErr) {
      console.warn("Routing service unavailable, using fallback:", routeErr.message);
      // Fallback: pick nearest by simple haversine
      const { findNearest } = require("../utils/geoUtils");
      const { item: nearest, distance } = findNearest(lat, lng, shelters);
      routeData = {
        shelter: { id: nearest._id.toString(), name: nearest.name, lat: nearest.location.lat, lng: nearest.location.lng },
        distance,
        estimatedTimeMinutes: Math.round((distance / 30) * 60),
        route: [{ lat, lng }, { lat: nearest.location.lat, lng: nearest.location.lng }],
      };
    }

    // Find shelter document
    const shelter = shelters.find((s) => s._id.toString() === routeData.shelter.id) || shelters[0];

    // Create emergency record
    const emergency = await Emergency.create({
      user: req.user._id,
      type: "safe",
      status: "resolved",
      location: { lat, lng },
      shelter: shelter._id,
      route: routeData.route,
      routeDistance: routeData.distance,
      estimatedTime: routeData.estimatedTimeMinutes,
      resolvedAt: new Date(),
    });

    // Increment shelter occupancy
    await Shelter.findByIdAndUpdate(shelter._id, { $inc: { currentOccupancy: 1 } });

    res.status(201).json({
      success: true,
      message: "Route to nearest shelter generated",
      emergency,
      shelter: { ...routeData.shelter, dataSource: shelter.dataSource },
      route: routeData.route,
      distance: routeData.distance,
      estimatedTimeMinutes: routeData.estimatedTimeMinutes,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/emergency/rescue
exports.requestRescue = async (req, res, next) => {
  try {
    const { lat, lng, notes } = req.body;

    if (!isValidCoords(lat, lng)) {
      return res.status(400).json({ success: false, message: "Invalid coordinates" });
    }

    if (!isInsideChandigarh(lat, lng)) {
      return res.status(422).json(OUTSIDE_AREA_RESPONSE);
    }

    // Create emergency
    const emergency = await Emergency.create({
      user: req.user._id,
      type: "rescue",
      status: "pending",
      location: { lat, lng, address: req.body.address },
      notes,
    });

    const populated = await emergency.populate("user", "name email phone");

    // Notify admins via Socket.IO
    req.io.to("admin").emit("emergency:new", {
      emergency: populated,
      message: `New rescue request from ${req.user.name}`,
    });

    res.status(201).json({
      success: true,
      message: "Rescue request submitted — help is on the way",
      emergency: populated,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/emergency/my
exports.getMyEmergencies = async (req, res, next) => {
  try {
    const emergencies = await Emergency.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate("assignedTeam", "name phone")
      .populate("shelter", "name address location");

    res.json({ success: true, count: emergencies.length, emergencies });
  } catch (err) {
    next(err);
  }
};

// GET /api/emergency/:id
exports.getEmergencyById = async (req, res, next) => {
  try {
    const emergency = await Emergency.findById(req.params.id)
      .populate("user", "name email phone")
      .populate("assignedTeam", "name email phone")
      .populate("shelter", "name address location");

    if (!emergency) {
      return res.status(404).json({ success: false, message: "Emergency not found" });
    }

    // Only the owner, admin, or assigned team can view
    if (
      req.user.role === "user" &&
      emergency.user._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json({ success: true, emergency });
  } catch (err) {
    next(err);
  }
};

// GET /api/emergency/:id/tracking — victim-facing live-tracking snapshot
// (assigned team, its last known location, route/distance/ETA). Used to
// recover state after a page refresh or when opening an SOS from history;
// live changes after that arrive over Socket.IO (`emergency:trackingUpdate`).
exports.getEmergencyTracking = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid emergency id" });
    }

    const emergency = await Emergency.findById(req.params.id);
    if (!emergency || emergency.type !== "rescue") {
      return res.status(404).json({ success: false, message: "Emergency not found" });
    }

    const isOwner = emergency.user.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const tracking = await buildTrackingSnapshot(emergency);
    res.json({ success: true, tracking });
  } catch (err) {
    next(err);
  }
};
