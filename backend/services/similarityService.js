/**
 * Historical earthquake similarity (KNN) — helpers used by controllers/similarityController.js.
 *
 * The matching of an SOS to a stored earthquake is NOT done here: the controller reuses
 * severityService.findQuakeContext(), so this feature analyses exactly the same earthquake the
 * Random Forest severity panel does. This file only asks the Python ML service (ml-service/,
 * POST /similar) for the five most similar earthquakes in its historical USGS/PAGER dataset.
 *
 * Read-only: nothing here writes to MongoDB, and the result never assigns a team, changes a
 * status, ranks emergencies, or touches the Random Forest prediction.
 */
const axios = require("axios");

const mlUrl = () => process.env.ML_SERVICE_URL || "http://localhost:8001";

/** Error carrying an HTTP status + machine-readable code for the controller to return. */
class SimilarityError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "SimilarityError";
    this.status = status;
    this.code = code;
  }
}

// Only these ML-service codes are passed through to the browser; anything else becomes a generic error.
const DATA_CODES = new Set(["HISTORICAL_DATA_NOT_AVAILABLE", "HISTORICAL_DATA_EMPTY", "HISTORICAL_DATA_LOAD_FAILED"]);

/**
 * Ask the ML service for the most similar historical earthquakes.
 * `eventId` / `time` are optional and only let the ML service exclude the current event itself.
 * Throws SimilarityError (status + code) on any failure; never leaks internal error text.
 */
const fetchSimilarEarthquakes = async ({ magnitude, depth, latitude, longitude, eventId, time }) => {
  const body = { magnitude, depth, latitude, longitude };
  if (typeof eventId === "string" && eventId) body.eventId = eventId;
  if (time) {
    const t = new Date(time);
    if (!Number.isNaN(t.getTime())) body.time = t.toISOString();
  }

  try {
    const { data } = await axios.post(`${mlUrl()}/similar`, body, { timeout: 8000 });
    const { success, ...result } = data;
    return result;
  } catch (err) {
    if (err.response) {
      const { status, data } = err.response;
      if (status === 400) {
        throw new SimilarityError(400, "INVALID_INPUT", data?.message || "Invalid earthquake parameters");
      }
      if (status === 503 && DATA_CODES.has(data?.code)) {
        throw new SimilarityError(503, data.code, data?.message || "The historical earthquake dataset is not available");
      }
      if (status === 404) {
        // A Flask app without the /similar route: the ML service is still running the older code.
        throw new SimilarityError(
          503,
          "ML_SERVICE_OUTDATED",
          "The running ML service does not support historical similarity yet. Restart it (python app.py in ml-service/) so it loads the updated code."
        );
      }
      throw new SimilarityError(502, "ML_SERVICE_ERROR", "The ML service returned an unexpected error");
    }
    throw new SimilarityError(
      503,
      "ML_SERVICE_UNAVAILABLE",
      "The ML service is not reachable. Start it (see ml-service/README.md) and try again."
    );
  }
};

module.exports = { fetchSimilarEarthquakes, SimilarityError };
