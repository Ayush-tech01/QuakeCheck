const Emergency = require("../models/Emergency");
const User = require("../models/User");
const { getRouteBetween } = require("./routingService");
const { isValidCoords } = require("../utils/geoUtils");

// A team is BUSY while it holds an emergency in one of these states.
// Availability is derived from Emergency data only — there is no separate
// team-status field to keep in sync.
const BUSY_STATUSES = ["assigned", "en_route"];

const hasValidBase = (team) => isValidCoords(team.baseLocation?.lat, team.baseLocation?.lng);

/**
 * Map of teamId (string) → the emergency id that makes it busy.
 * One query for all teams.
 */
const getBusyTeamMap = async (teamIds) => {
  if (!teamIds.length) return new Map();
  const busy = await Emergency.find({
    assignedTeam: { $in: teamIds },
    status: { $in: BUSY_STATUSES },
  })
    .select("assignedTeam")
    .lean();
  return new Map(busy.map((e) => [String(e.assignedTeam), String(e._id)]));
};

/**
 * Availability for already-loaded ACTIVE rescue teams ("available" | "busy").
 * Used by GET /admin/rescue-teams so the dashboard can show green/red.
 */
const withAvailability = async (teams) => {
  const busyMap = await getBusyTeamMap(teams.map((t) => t._id));
  return teams.map((t) => ({
    ...t,
    availability: busyMap.has(String(t._id)) ? "busy" : "available",
  }));
};

const byEtaThenDistanceThenName = (a, b) =>
  a.estimatedTimeMinutes - b.estimatedTimeMinutes ||
  a.distance - b.distance ||
  a.name.localeCompare(b.name);

/**
 * Rank rescue teams for one emergency by REAL ROAD travel time from each
 * team's BASE to the victim (existing getRouteBetween → routing service →
 * OSRM). Not straight-line distance.
 *
 * - every rescue_team is returned, tagged available / busy / unavailable
 *   (inactive); only "available" teams with a valid base are routed
 * - routes are fetched concurrently; each failure is handled per team, so one
 *   OSRM error never fails the request, and no ETA/distance is ever invented
 * - the polyline is deliberately not returned (not needed, and 6× large)
 */
const buildRecommendations = async (emergency) => {
  const victim = { lat: emergency.location.lat, lng: emergency.location.lng };

  const teams = await User.find({ role: "rescue_team" })
    .select("name phone isActive baseLocation")
    .lean();

  const busyMap = await getBusyTeamMap(teams.filter((t) => t.isActive).map((t) => t._id));

  const entries = teams.map((t) => {
    const availability = !t.isActive ? "unavailable" : busyMap.has(String(t._id)) ? "busy" : "available";
    return {
      teamId: t._id,
      name: t.name,
      phone: t.phone || null,
      availability,
      baseLocation: hasValidBase(t)
        ? { name: t.baseLocation.name || null, lat: t.baseLocation.lat, lng: t.baseLocation.lng }
        : null,
      distance: null,
      estimatedTimeMinutes: null,
      routeAvailable: false,
      routeUnavailableReason: null,
    };
  });

  await Promise.all(
    entries.map(async (e) => {
      if (e.availability !== "available") return; // busy / inactive: never routed
      if (!e.baseLocation) {
        e.routeUnavailableReason = "no_base_location";
        return;
      }
      try {
        const r = await getRouteBetween(e.baseLocation.lat, e.baseLocation.lng, victim.lat, victim.lng);
        if (Number.isFinite(r?.distance) && Number.isFinite(r?.estimatedTimeMinutes)) {
          e.distance = r.distance;
          e.estimatedTimeMinutes = r.estimatedTimeMinutes;
          e.routeAvailable = true;
        } else {
          e.routeUnavailableReason = "route_unavailable";
        }
      } catch (err) {
        console.warn(`Recommendation route failed for ${e.name}:`, err.message);
        e.routeUnavailableReason = "route_unavailable";
      }
    })
  );

  const rank = (e) => (e.routeAvailable ? 0 : e.availability === "available" ? 1 : e.availability === "busy" ? 2 : 3);
  entries.sort((a, b) => rank(a) - rank(b) || (a.routeAvailable ? byEtaThenDistanceThenName(a, b) : a.name.localeCompare(b.name)));

  const best = entries.find((e) => e.routeAvailable) || null;
  const available = entries.filter((e) => e.availability === "available");
  const busy = entries.filter((e) => e.availability === "busy");

  let message = null;
  if (!best) {
    if (available.length === 0 && busy.length > 0) message = "All rescue teams are currently handling emergencies.";
    else if (available.length === 0) message = "No rescue teams currently available.";
    else message = "No available rescue team with a valid route.";
  }

  return {
    victimLocation: victim,
    recommendedTeam: best
      ? {
          teamId: best.teamId,
          name: best.name,
          baseLocation: best.baseLocation,
          distance: best.distance,
          estimatedTimeMinutes: best.estimatedTimeMinutes,
          routeAvailable: true,
        }
      : null,
    teams: entries,
    message,
  };
};

module.exports = { buildRecommendations, withAvailability, getBusyTeamMap, BUSY_STATUSES };
