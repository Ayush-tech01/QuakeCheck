const {
  getChandigarhBoundaryGeoJSON,
  getChandigarhBounds,
  CHANDIGARH_CENTER,
} = require("../utils/geoUtils");

// GET /api/region
// Single source of truth for the app's operational region, so the frontend
// map and any geofence UI stay in sync with the backend's actual boundary
// data instead of maintaining a second, potentially-drifting copy.
exports.getRegion = async (req, res, next) => {
  try {
    res.json({
      success: true,
      region: {
        name: "Chandigarh",
        country: "India",
        center: CHANDIGARH_CENTER,
        bounds: getChandigarhBounds(),
        boundary: getChandigarhBoundaryGeoJSON(),
      },
    });
  } catch (err) {
    next(err);
  }
};
