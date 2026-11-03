const Emergency = require("../models/Emergency");
const User = require("../models/User");
const { getRouteBetween } = require("../services/routingService");
const { buildRecommendations, withAvailability } = require("../services/teamRecommendationService.js");
const { isValidCoords } = require("../utils/geoUtils");
const mongoose = require("mongoose");

// GET /api/admin/emergencies
exports.getAllEmergencies = async (req, res, next) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [emergencies, total] = await Promise.all([
      Emergency.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("user", "name email phone")
        .populate("assignedTeam", "name email phone"),
      Emergency.countDocuments(filter),
    ]);

    res.json({ success: true, total, page: parseInt(page), emergencies });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/stats
exports.getAdminStats = async (req, res, next) => {
  try {
    const [total, pending, assigned, resolved, rescueTeams] = await Promise.all([
      Emergency.countDocuments(),
      Emergency.countDocuments({ status: "pending" }),
      Emergency.countDocuments({ status: { $in: ["assigned", "en_route"] } }),
      Emergency.countDocuments({ status: "resolved" }),
      User.countDocuments({ role: "rescue_team" }),
    ]);

    res.json({
      success: true,
      stats: { total, pending, assigned, resolved, rescueTeams },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/rescue-teams
exports.getRescueTeams = async (req, res, next) => {
  try {
    const activeTeams = await User.find({ role: "rescue_team", isActive: true }).lean();
    // Adds `availability: "available" | "busy"` (derived server-side from
    // assigned / en_route emergencies); all existing fields are unchanged.
    const teams = await withAvailability(activeTeams);
    res.json({ success: true, teams });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/emergencies/:id/recommendations
// "Fastest available rescue team": ranks available teams by real road ETA from
// their BASE to the victim. Recommendation only — nothing is assigned here;
// the admin decides and uses the existing assign endpoint.
exports.getTeamRecommendations = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid emergency id" });
    }

    const emergency = await Emergency.findById(req.params.id);
    if (!emergency) {
      return res.status(404).json({ success: false, message: "Emergency not found" });
    }
    if (emergency.type !== "rescue") {
      return res.status(400).json({ success: false, message: "Recommendations only apply to rescue SOS requests" });
    }
    if (!isValidCoords(emergency.location?.lat, emergency.location?.lng)) {
      return res.status(400).json({ success: false, message: "Emergency has no valid location" });
    }

    // Already handled: skip the routing work entirely.
    if (emergency.status !== "pending") {
      return res.json({
        success: true,
        emergencyId: emergency._id,
        emergencyStatus: emergency.status,
        victimLocation: { lat: emergency.location.lat, lng: emergency.location.lng },
        recommendedTeam: null,
        teams: [],
        message: "This emergency is no longer pending, so no recommendation is needed.",
      });
    }

    const result = await buildRecommendations(emergency);
    res.json({ success: true, emergencyId: emergency._id, emergencyStatus: emergency.status, ...result });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/emergencies/:id/assign
exports.assignRescueTeam = async (req, res, next) => {
  try {
    const { teamId } = req.body;
    const emergency = await Emergency.findById(req.params.id);
    if (!emergency) {
      return res.status(404).json({ success: false, message: "Emergency not found" });
    }

    const team = await User.findById(teamId);
    if (!team || team.role !== "rescue_team") {
      return res.status(400).json({ success: false, message: "Invalid rescue team" });
    }

    // Get route from rescue team's current location to the victim. Per the
    // "no fake routes" requirement: if we can't compute a real route (team
    // hasn't reported a location yet, or the routing service fails), we
    // record that honestly via routeStatus rather than drawing any kind of
    // placeholder line — the frontend is responsible for showing an
    // appropriate "route unavailable" state instead.
    let route = [];
    let routeDistance = null;
    let estimatedTime = null;
    let routeOrigin = null;
    let routeStatus = "pending"; // no team location yet to route from

    if (team.location?.lat && emergency.location?.lat) {
      try {
        const routeData = await getRouteBetween(
          team.location.lat,
          team.location.lng,
          emergency.location.lat,
          emergency.location.lng
        );
        route = routeData.route || [];
        routeDistance = routeData.distance;
        estimatedTime = routeData.estimatedTimeMinutes;
        routeOrigin = { lat: team.location.lat, lng: team.location.lng };
        routeStatus = "ok";
      } catch (e) {
        console.warn("Route generation failed:", e.message);
        routeStatus = "unavailable";
      }
    }

    // Capture the victim's id NOW, while emergency.user is still a bare
    // ObjectId. populate() below mutates the document in place, after which
    // `emergency.user` is a whole User document — and `user:${emergency.user}`
    // would then be the string "user:{ name: ..., _id: ... }", a room nobody is
    // in, so the victim never received the assignment event.
    const victimId = String(emergency.user);

    emergency.assignedTeam = teamId;
    emergency.status = "assigned";
    emergency.route = route;
    emergency.routeDistance = routeDistance;
    emergency.estimatedTime = estimatedTime;
    emergency.routeOrigin = routeOrigin;
    emergency.routeStatus = routeStatus;
    await emergency.save();

    const populated = await emergency.populate([
      { path: "user", select: "name email phone" },
      { path: "assignedTeam", select: "name email phone" },
    ]);

    // Notify the rescue team
    req.io.to(`rescue:${teamId}`).emit("emergency:assigned", {
      emergency: populated,
      message: "You have been assigned a rescue mission",
    });

    // Notify the victim: their personal room (any open page) and this SOS's
    // tracking room (a page subscribed to it). Chained .to().to() delivers
    // once to a socket that is in both.
    req.io.to(`user:${victimId}`).to(`emergency:${emergency._id}`).emit("emergency:status", {
      emergencyId: emergency._id,
      status: "assigned",
      team: { name: team.name, phone: team.phone },
      message: "A rescue team has been assigned to you",
    });

    res.json({ success: true, message: "Rescue team assigned", emergency: populated });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/emergencies/:id/status
exports.updateEmergencyStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ["pending", "assigned", "en_route", "resolved", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const emergency = await Emergency.findByIdAndUpdate(
      req.params.id,
      { status, ...(status === "resolved" ? { resolvedAt: new Date() } : {}) },
      { new: true }
    ).populate("user assignedTeam");

    if (!emergency) return res.status(404).json({ success: false, message: "Not found" });

    req.io.to(`user:${emergency.user._id}`).emit("emergency:status", {
      emergencyId: emergency._id,
      status,
    });

    res.json({ success: true, emergency });
  } catch (err) {
    next(err);
  }
};
