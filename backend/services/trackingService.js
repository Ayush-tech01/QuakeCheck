const User = require("../models/User");

// Emergency statuses during which a rescue team is actively attached to the
// mission (and therefore during which its location is shared with the victim).
const ACTIVE_STATUSES = ["assigned", "en_route"];

const slimRoute = (route) => (route || []).map((p) => ({ lat: p.lat, lng: p.lng }));

/**
 * Build the victim-facing "live tracking" snapshot for an emergency.
 *
 * Reuses data the backend already maintains — nothing new is stored:
 *   - team location  → User.location (written by PATCH /api/rescue/location)
 *   - route/distance/ETA/routeStatus → Emergency fields, recalculated through
 *     the routing service (OSRM) whenever the team moves meaningfully
 *
 * The team's location and the route are only included while the mission is
 * active (assigned / en_route), so a resolved or cancelled SOS never keeps
 * exposing a team's position.
 *
 * Used by: GET /api/emergency/:id/tracking, the `emergency:subscribe` socket
 * ack, so a victim who (re)opens the page gets the latest state immediately
 * instead of waiting for the next live update.
 */
const buildTrackingSnapshot = async (emergency) => {
  const snapshot = {
    emergencyId: emergency._id,
    status: emergency.status,
    victimLocation: { lat: emergency.location.lat, lng: emergency.location.lng },
    team: null,
    teamLocation: null,
    route: [],
    distance: null,
    estimatedTime: null,
    routeStatus: emergency.routeStatus || "pending",
    serverTime: new Date(),
  };

  if (!emergency.assignedTeam) return snapshot;

  const teamId = emergency.assignedTeam._id || emergency.assignedTeam;
  const team = await User.findById(teamId).select("name phone location");
  if (!team) return snapshot;

  snapshot.team = { name: team.name, phone: team.phone };

  if (ACTIVE_STATUSES.includes(emergency.status)) {
    if (team.location?.lat != null && team.location?.lng != null) {
      snapshot.teamLocation = {
        lat: team.location.lat,
        lng: team.location.lng,
        updatedAt: team.location.updatedAt || null,
      };
    }
    if (emergency.routeStatus === "ok") {
      snapshot.route = slimRoute(emergency.route);
      snapshot.distance = emergency.routeDistance ?? null;
      snapshot.estimatedTime = emergency.estimatedTime ?? null;
    }
  }

  return snapshot;
};

module.exports = { buildTrackingSnapshot, slimRoute, ACTIVE_STATUSES };
