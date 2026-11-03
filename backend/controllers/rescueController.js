const Emergency = require("../models/Emergency");
const User = require("../models/User");
const { getRouteBetween } = require("../services/routingService");
const { haversineDistance, isValidCoords } = require("../utils/geoUtils");
const { slimRoute } = require("../services/trackingService");

// Minimum movement (km) before we bother recalculating a route on a location
// update — avoids hammering the routing service on every small GPS jitter
// between reports. ~30m: enough to filter out jitter, small enough that a
// team actually moving will still see the route update promptly.
const MIN_RECALC_DISTANCE_KM = 0.03;

// GET /api/rescue/assigned — Get emergencies assigned to the requesting rescue team
exports.getAssignedEmergencies = async (req, res, next) => {
  try {
    const emergencies = await Emergency.find({
      assignedTeam: req.user._id,
      status: { $in: ["assigned", "en_route"] },
    })
      .sort({ createdAt: -1 })
      .populate("user", "name email phone location");

    res.json({ success: true, count: emergencies.length, emergencies });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/rescue/en-route/:id — Mark as en route
exports.markEnRoute = async (req, res, next) => {
  try {
    const emergency = await Emergency.findOneAndUpdate(
      { _id: req.params.id, assignedTeam: req.user._id },
      { status: "en_route" },
      { new: true }
    ).populate("user", "name phone");

    if (!emergency) return res.status(404).json({ success: false, message: "Not found" });

    req.io.to(`user:${emergency.user._id}`).emit("emergency:status", {
      emergencyId: emergency._id,
      status: "en_route",
      message: "Rescue team is now on the way!",
    });

    res.json({ success: true, emergency });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/rescue/complete/:id — Mark rescue as resolved
exports.completeRescue = async (req, res, next) => {
  try {
    const emergency = await Emergency.findOneAndUpdate(
      { _id: req.params.id, assignedTeam: req.user._id },
      { status: "resolved", resolvedAt: new Date() },
      { new: true }
    ).populate("user", "name phone");

    if (!emergency) return res.status(404).json({ success: false, message: "Not found" });

    req.io.to(`user:${emergency.user._id}`).emit("emergency:status", {
      emergencyId: emergency._id,
      status: "resolved",
      message: "You have been rescued. Stay safe!",
    });

    // Notify admin
    req.io.to("admin").emit("emergency:resolved", {
      emergencyId: emergency._id,
      resolvedBy: req.user.name,
    });

    res.json({ success: true, message: "Rescue mission completed", emergency });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/rescue/location — Update rescue team's GPS location
//
// Besides saving the team's latest location, this fans the update out to the
// victims of every mission currently active for this team, over Socket.IO:
//   - `emergency:trackingUpdate` → room `emergency:<id>` (victim live view)
//   - `emergency:routeUpdated`   → room `rescue:<teamId>` (rescue dashboard)
// Target emergencies are derived server-side from assignedTeam — a client-sent
// emergencyId is deliberately NOT trusted, so a team can only ever publish its
// own location to its own assigned victims.
exports.updateLocation = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;

    if (!isValidCoords(lat, lng)) {
      return res.status(400).json({ success: false, message: "Invalid coordinates" });
    }

    const updatedAt = new Date();
    await User.findByIdAndUpdate(req.user._id, {
      location: { lat, lng, updatedAt },
    });

    // Live tracking + route recalculation: for every mission currently active
    // for this team, (1) push the new team position to that victim right away,
    // then (2) recompute the real road route (OSRM, via the routing service)
    // only if the team moved far enough to matter, and push that out too.
    // Deliberately isolated in its own try/catch — a routing or socket hiccup
    // here must never fail the location-update response itself, since the
    // location was already saved successfully above.
    try {
      const activeEmergencies = await Emergency.find({
        assignedTeam: req.user._id,
        status: { $in: ["assigned", "en_route"] },
      });

      for (const emergency of activeEmergencies) {
        // `routeOrigin` is a nested path, so Mongoose hands back `{}` (or null)
        // — never undefined — when no route has been computed yet, e.g. when
        // the team had not shared a location at the moment it was assigned.
        // `!lastOrigin` alone treats `{}` as "has an origin", haversine of
        // undefined coords is NaN, and `NaN > 0.03` is false: the first route
        // was then skipped forever. Only a real coordinate pair counts.
        const lastOrigin = emergency.routeOrigin;
        const hasLastOrigin = isValidCoords(lastOrigin?.lat, lastOrigin?.lng);
        const movedEnough =
          !hasLastOrigin ||
          haversineDistance(lastOrigin.lat, lastOrigin.lng, lat, lng) > MIN_RECALC_DISTANCE_KM;

        let victimRouteFields = {};

        if (movedEnough) {
          try {
            const routeData = await getRouteBetween(
              lat,
              lng,
              emergency.location.lat,
              emergency.location.lng
            );
            emergency.route = routeData.route;
            emergency.routeDistance = routeData.distance;
            emergency.estimatedTime = routeData.estimatedTimeMinutes;
            emergency.routeOrigin = { lat, lng };
            emergency.routeStatus = "ok";
          } catch (routeErr) {
            // Victim location stays put — only the "no route available" state
            // changes. We deliberately do NOT draw any placeholder line here.
            console.warn(`Route from team location to emergency ${emergency._id} failed:`, routeErr.message);
            emergency.routeStatus = "unavailable";
          }
          await emergency.save();

          req.io.to(`rescue:${req.user._id}`).emit("emergency:routeUpdated", {
            emergencyId: emergency._id,
            route: emergency.route,
            distance: emergency.routeDistance,
            estimatedTime: emergency.estimatedTime,
            routeStatus: emergency.routeStatus,
          });

          // Same data for the victim; route fields are only included when
          // they actually changed, so a stationary team doesn't resend the
          // whole polyline on every location report.
          const ok = emergency.routeStatus === "ok";
          victimRouteFields = {
            route: ok ? slimRoute(emergency.route) : [],
            distance: ok ? emergency.routeDistance : null,
            estimatedTime: ok ? emergency.estimatedTime : null,
            routeStatus: emergency.routeStatus,
          };
        }

        req.io.to(`emergency:${emergency._id}`).emit("emergency:trackingUpdate", {
          emergencyId: emergency._id,
          teamLocation: { lat, lng, updatedAt },
          serverTime: new Date(),
          ...victimRouteFields,
        });
      }
    } catch (recalcErr) {
      console.warn("Live tracking / route recalculation on location update failed:", recalcErr.message);
    }

    res.json({ success: true, message: "Location updated" });
  } catch (err) {
    next(err);
  }
};
