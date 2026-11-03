const mongoose = require("mongoose");
const Emergency = require("../models/Emergency");
const { findQuakeContext } = require("../services/severityService");
const { fetchSimilarEarthquakes, SimilarityError } = require("../services/similarityService");

const DISCLAIMER =
  "Informational only. These are past earthquakes that resemble this one in size, depth and location. " +
  "It does not predict this earthquake's impact, is separate from the Random Forest severity estimate, " +
  "and does not assign teams, change emergency status, or set rescue priority.";

const noMatchMessage = ({ reason, criteria }) => {
  const needs = "Historical similarity analysis needs a matched earthquake, and none could be matched to this SOS. ";
  if (reason === "SOS_LOCATION_UNAVAILABLE") {
    return needs + "This SOS has no valid location. You can compare a hypothetical scenario instead.";
  }
  if (reason === "SOS_TIME_UNAVAILABLE") {
    return needs + "This SOS has no valid timestamp. You can compare a hypothetical scenario instead.";
  }
  return (
    needs +
    `No earthquake of magnitude ${criteria.minMagnitude}+ was found within ${criteria.radiusKm} km of this SOS ` +
    `in the ${criteria.windowHours} hours before it was raised. That does not prove none occurred: the feed only ` +
    "holds events fetched from USGS while the server was running. You can compare a hypothetical scenario instead."
  );
};

const SCENARIO_FIELDS = ["magnitude", "depth", "latitude", "longitude"];

// Shape check only; value ranges are enforced by the ML service (single source of truth).
const readScenario = (body) => {
  const s = body?.scenario;
  if (s === undefined) return { scenario: null };
  const ok = s && typeof s === "object" && SCENARIO_FIELDS.every((f) => typeof s[f] === "number" && Number.isFinite(s[f]));
  if (!ok) {
    return { error: `scenario must be an object with numeric ${SCENARIO_FIELDS.join(", ")}` };
  }
  return { scenario: Object.fromEntries(SCENARIO_FIELDS.map((f) => [f, s[f]])) };
};

// POST /api/admin/emergencies/:id/similar-earthquakes   (admin only — see routes/admin.js)
// Body (optional): { scenario: { magnitude, depth, latitude, longitude } } — a HYPOTHETICAL comparison.
// Without it, the SAME earthquake the severity panel analyses (matched to this SOS by its own
// location and timestamp, severityService.findQuakeContext) is compared with historical earthquakes.
// If no earthquake is matched, nothing is guessed and no unrelated earthquake is substituted.
// READ-ONLY: never writes to the database or emits socket events, and never touches the severity result.
exports.findSimilarEarthquakes = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid emergency id" });
    }
    const emergency = await Emergency.findById(req.params.id);
    if (!emergency) {
      return res.status(404).json({ success: false, message: "Emergency not found" });
    }
    if (emergency.type !== "rescue") {
      return res.status(400).json({ success: false, message: "Historical similarity only applies to rescue SOS requests" });
    }

    const { scenario, error } = readScenario(req.body);
    if (error) return res.status(400).json({ success: false, code: "INVALID_INPUT", message: error });

    const base = { success: true, informational: true, emergencyId: emergency._id, disclaimer: DISCLAIMER };

    // Hypothetical what-if: clearly labelled, never presented as a real earthquake record.
    if (scenario) {
      const similarity = await fetchSimilarEarthquakes(scenario);
      return res.json({ ...base, source: "manual", hypothetical: true, quake: null, matching: null, similarity });
    }

    const match = await findQuakeContext(emergency);
    const matching = {
      ...match.criteria,
      candidatesConsidered: match.candidatesConsidered,
      sosCreatedAt: emergency.createdAt,
      sosLocation: emergency.location ? { lat: emergency.location.lat, lng: emergency.location.lng } : null,
    };
    const quake = match.quake;
    if (!quake) {
      return res.json({
        ...base,
        source: "feed",
        hypothetical: false,
        quake: null,
        matching,
        similarity: null,
        code: match.reason,
        message: noMatchMessage(match),
      });
    }

    const similarity = await fetchSimilarEarthquakes({
      magnitude: quake.magnitude,
      depth: quake.depth,
      latitude: quake.location.lat,
      longitude: quake.location.lng,
      eventId: quake.eventId,
      time: quake.time,
    });
    res.json({ ...base, source: "feed", hypothetical: false, quake, matching, similarity });
  } catch (err) {
    if (err instanceof SimilarityError) {
      return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    }
    next(err);
  }
};
