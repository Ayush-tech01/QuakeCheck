const mongoose = require("mongoose");
const Emergency = require("../models/Emergency");
const { findQuakeContext, predictSeverity, SeverityError } = require("../services/severityService");

const DISCLAIMER =
  "Advisory only. This is a machine-learning estimate of the earthquake's likely impact category. " +
  "It does not assign teams, change emergency status, or set rescue priority.";

const noMatchMessage = ({ reason, criteria }) => {
  if (reason === "SOS_LOCATION_UNAVAILABLE") {
    return "This SOS has no valid location, so no earthquake can be matched to it. You can enter a manual scenario instead.";
  }
  if (reason === "SOS_TIME_UNAVAILABLE") {
    return "This SOS has no valid timestamp, so no earthquake can be matched to it. You can enter a manual scenario instead.";
  }
  return (
    `No earthquake of magnitude ${criteria.minMagnitude}+ was found within ${criteria.radiusKm} km of this SOS ` +
    `in the ${criteria.windowHours} hours before it was raised. That does not prove none occurred: the feed only ` +
    "holds events fetched from USGS while the server was running. You can enter a manual scenario instead."
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

// POST /api/admin/emergencies/:id/severity
// Body (optional): { scenario: { magnitude, depth, latitude, longitude } } — a manual
// what-if run. Without it, the strongest stored earthquake matched to THIS SOS by its own
// location and timestamp (see services/severityService.js) is analysed.
// READ-ONLY: this handler never writes to the database or emits socket events.
exports.analyzeSeverity = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid emergency id" });
    }
    const emergency = await Emergency.findById(req.params.id);
    if (!emergency) {
      return res.status(404).json({ success: false, message: "Emergency not found" });
    }
    if (emergency.type !== "rescue") {
      return res.status(400).json({ success: false, message: "Severity analysis only applies to rescue SOS requests" });
    }

    const { scenario, error } = readScenario(req.body);
    if (error) return res.status(400).json({ success: false, code: "INVALID_INPUT", message: error });

    let source = "manual";
    let quake = null;
    let matching = null;
    let otherCandidates = [];
    let input = scenario;

    if (!scenario) {
      source = "feed";
      const match = await findQuakeContext(emergency);
      matching = {
        ...match.criteria,
        candidatesConsidered: match.candidatesConsidered,
        sosCreatedAt: emergency.createdAt,
        sosLocation: emergency.location ? { lat: emergency.location.lat, lng: emergency.location.lng } : null,
      };
      otherCandidates = match.others;
      quake = match.quake;
      if (!quake) {
        return res.json({
          success: true,
          advisory: true,
          emergencyId: emergency._id,
          source,
          quake: null,
          otherCandidates: [],
          matching,
          prediction: null,
          code: match.reason,
          message: noMatchMessage(match),
          disclaimer: DISCLAIMER,
        });
      }
      input = {
        magnitude: quake.magnitude,
        depth: quake.depth,
        latitude: quake.location.lat,
        longitude: quake.location.lng,
      };
    }

    const prediction = await predictSeverity(input);
    res.json({
      success: true,
      advisory: true,
      emergencyId: emergency._id,
      source,
      quake,
      otherCandidates,
      matching,
      prediction,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    if (err instanceof SeverityError) {
      return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    }
    next(err);
  }
};
