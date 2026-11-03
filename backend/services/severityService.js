/**
 * Severity analysis (advisory ML) — helpers used by controllers/severityController.js.
 *
 * Two jobs:
 *   1. findQuakeContext(): find stored earthquakes that match an SOS by LOCATION and TIME
 *      (its own coordinates and creation timestamp), and pick the strongest as the input
 *      for the model.
 *   2. predictSeverity(): ask the Python ML service (ml-service/) to classify it.
 *
 * "Matched" means only: near this SOS and shortly before it. It is NOT evidence that the
 * earthquake caused the SOS, and the UI says so. Nothing here writes to MongoDB, and the
 * prediction never assigns a team, changes a status, or ranks emergencies.
 */
const axios = require("axios");
const EarthquakeFeed = require("../models/EarthquakeFeed");
const { boundingBoxFilter } = require("../config/feedRegion");
const { haversineDistance, isValidCoords } = require("../utils/geoUtils");

// Matching criteria — practical heuristics, all configurable in backend/.env and all shown in
// the admin panel. They are read lazily so tests (and edits + restart) see current values.
const numberFromEnv = (name, fallback, { min = 0, allowZero = false } = {}) => {
  const v = Number(process.env[name]);
  if (process.env[name] === undefined || process.env[name] === "" || !Number.isFinite(v)) return fallback;
  return v > min || (allowZero && v === min) ? v : fallback;
};
const windowHours = () => numberFromEnv("SEVERITY_QUAKE_WINDOW_HOURS", 24);
const radiusKm = () => numberFromEnv("SEVERITY_MATCH_RADIUS_KM", 300);
// The model is trained only on events USGS assigned a PAGER alert to; tiny tremors would be
// out-of-distribution, so they are not matched at all.
const minMagnitude = () => numberFromEnv("SEVERITY_MIN_MAGNITUDE", 4.0, { allowZero: true });
const mlUrl = () => process.env.ML_SERVICE_URL || "http://localhost:8001";
const MAX_OTHERS = 4;

/** Error carrying an HTTP status + machine-readable code for the controller to return. */
class SeverityError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "SeverityError";
    this.status = status;
    this.code = code;
  }
}

const matchingCriteria = () => ({ radiusKm: radiusKm(), windowHours: windowHours(), minMagnitude: minMagnitude() });

/**
 * Earthquakes stored in the feed that are (a) within radiusKm of the SOS's own location,
 * (b) at or after (SOS time − windowHours) and not after the SOS, and (c) at least
 * minMagnitude. Returns:
 *   { quake, others, criteria, candidatesConsidered, reason }
 * `quake` is the strongest candidate (ties: nearest), `others` the next few, each with
 * distanceKm and minutesBeforeSos. When nothing can be matched, `quake` is null and
 * `reason` says why — nothing is guessed (no SOS location/time → no match).
 */
const findQuakeContext = async (emergency) => {
  const criteria = matchingCriteria();
  const none = (reason) => ({ quake: null, others: [], criteria, candidatesConsidered: 0, reason });

  const sosLat = Number(emergency.location?.lat);
  const sosLng = Number(emergency.location?.lng);
  if (emergency.location?.lat == null || emergency.location?.lng == null || !isValidCoords(sosLat, sosLng)) {
    return none("SOS_LOCATION_UNAVAILABLE");
  }

  const sosTime = emergency.createdAt ? new Date(emergency.createdAt) : null;
  if (!sosTime || Number.isNaN(sosTime.getTime())) return none("SOS_TIME_UNAVAILABLE");

  const windowStart = new Date(sosTime.getTime() - criteria.windowHours * 3600 * 1000);
  const rows = await EarthquakeFeed.find({
    time: { $gte: windowStart, $lte: sosTime },
    magnitude: { $gte: criteria.minMagnitude },
    ...boundingBoxFilter({ center: { lat: sosLat, lng: sosLng }, radiusKm: criteria.radiusKm }),
  })
    .sort({ magnitude: -1 })
    .limit(200)
    .lean();

  const candidates = rows
    .filter((q) => Number.isFinite(q.magnitude) && Number.isFinite(q.depth) && Number.isFinite(q.location?.lat) && Number.isFinite(q.location?.lng))
    .map((q) => ({
      eventId: q.eventId,
      place: q.place,
      time: q.time,
      magnitude: q.magnitude,
      depth: q.depth,
      location: { lat: q.location.lat, lng: q.location.lng },
      distanceKm: Math.round(haversineDistance(sosLat, sosLng, q.location.lat, q.location.lng) * 10) / 10,
      minutesBeforeSos: Math.round((sosTime.getTime() - new Date(q.time).getTime()) / 60000),
      officialAlert: q.alert || null, // USGS's own PAGER alert, when it has published one
      source: q.source,
    }))
    .filter((c) => c.distanceKm <= criteria.radiusKm)
    .sort((a, b) => b.magnitude - a.magnitude || a.distanceKm - b.distanceKm);

  return {
    quake: candidates[0] || null,
    others: candidates.slice(1, 1 + MAX_OTHERS),
    criteria,
    candidatesConsidered: candidates.length,
    reason: candidates.length ? null : "NO_MATCHING_EARTHQUAKE",
  };
};

/** Call the ML service. Throws SeverityError with an appropriate status/code on failure. */
const predictSeverity = async ({ magnitude, depth, latitude, longitude }) => {
  try {
    const { data } = await axios.post(
      `${mlUrl()}/predict`,
      { magnitude, depth, latitude, longitude },
      { timeout: 8000 }
    );
    const { success, ...prediction } = data;
    return prediction;
  } catch (err) {
    if (err.response) {
      const { status, data } = err.response;
      if (status === 400) {
        throw new SeverityError(400, data?.code || "INVALID_INPUT", data?.message || "Invalid earthquake parameters");
      }
      if (status === 503) {
        throw new SeverityError(503, data?.code || "MODEL_NOT_TRAINED", data?.message || "The severity model is not available");
      }
      throw new SeverityError(502, "ML_SERVICE_ERROR", "The ML service returned an unexpected error");
    }
    throw new SeverityError(
      503,
      "ML_SERVICE_UNAVAILABLE",
      "The ML service is not reachable. Start it (see ml-service/README.md) and try again."
    );
  }
};

module.exports = { findQuakeContext, predictSeverity, SeverityError, matchingCriteria };
