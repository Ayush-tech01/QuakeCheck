const axios = require("axios");

const ROUTING_URL = process.env.ROUTING_SERVICE_URL || "http://localhost:8000";

/**
 * Find the nearest shelter to the user and generate a route
 */
const getNearestShelterRoute = async (userLat, userLng, shelters) => {
  const payload = {
    userLat,
    userLng,
    shelters: shelters.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      lat: s.location.lat,
      lng: s.location.lng,
      capacity: s.capacity,
      currentOccupancy: s.currentOccupancy,
    })),
  };

  const { data } = await axios.post(`${ROUTING_URL}/nearest-shelter`, payload, {
    timeout: 10000,
  });
  return data;
};

/**
 * Get a real road route between two coordinate points (source → target),
 * backed by the routing service's OSRM-powered /route-between endpoint.
 *
 * Fixed bug: this previously passed the request body via axios's `data`
 * *argument* (source coords only) while also nesting a full `{source,
 * target}` object inside `config.data` — axios resolves that conflict in
 * favor of the positional argument, so `target` was silently dropped and
 * the routing service's /route-between call (which requires both source and
 * target) would 422 on every request, always falling back to a placeholder
 * route. The body is now passed correctly as the single positional
 * argument, with `config` used only for what it's actually for
 * (query params, timeout).
 */
const getRouteBetween = async (sourceLat, sourceLng, targetLat, targetLng) => {
  const { data } = await axios.post(
    `${ROUTING_URL}/route-between`,
    { source: { lat: sourceLat, lng: sourceLng }, target: { lat: targetLat, lng: targetLng } },
    { timeout: 10000 }
  );
  return data;
};

/**
 * Check routing service health
 */
const checkHealth = async () => {
  try {
    const { data } = await axios.get(`${ROUTING_URL}/health`, { timeout: 5000 });
    return data;
  } catch {
    return { status: "unreachable" };
  }
};

module.exports = { getNearestShelterRoute, getRouteBetween, checkHealth };
