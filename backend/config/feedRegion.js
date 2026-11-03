const { CHANDIGARH_CENTER, haversineDistance } = require("../utils/geoUtils");

/**
 * Geographic scope of the user-facing earthquake feed.
 *
 * The USGS sync (services/usgsSyncService.js) stores the WORLDWIDE feed, and
 * that stays as is. This only decides which stored events the dashboard
 * *shows* when it asks for `?region=india`. Nothing is deleted or hidden in
 * MongoDB, and requests without `region` still get the global list.
 *
 * Why a radius around Chandigarh and not a country/place-name match: USGS
 * `place` strings are free text ("12 km NE of Manali", "Hindu Kush region",
 * "Nepal-India border"), so matching names would both miss and mis-match
 * events. Coordinates are reliable.
 *
 * Why 1000 km: it matches the cut-off already built into the QuakeCheck Risk
 * model (utils/earthquakeRisk.js on the frontend), where any event beyond
 * 1000 km can only ever be LOW / informational. So everything that can matter
 * to Chandigarh is inside the feed, and nothing the risk model already treats
 * as irrelevant is. Roughly this covers Punjab, Haryana, Himachal, J&K,
 * Ladakh, Uttarakhand, Delhi/NCR, Rajasthan, UP, Nepal (incl. Kathmandu),
 * Pakistan and the Hindu Kush, and western Tibet. It does NOT reach Bhutan,
 * Lhasa, Assam/the north-east, Bangladesh, Myanmar or south India.
 * Change `radiusKm` here to widen/narrow it; nothing else needs editing.
 *
 * The centre is the project's existing Chandigarh reference point
 * (utils/geoUtils.js CHANDIGARH_CENTER), not a second copy.
 */
const FEED_REGIONS = {
  india: {
    key: "india",
    name: "India & Nearby Region",
    center: CHANDIGARH_CENTER, // { lat, lng }
    radiusKm: 1000,
  },
};

// Must match the Earth radius used by haversineDistance (6371 km), otherwise the
// box could end up a hair smaller than the circle it is meant to contain.
const KM_PER_DEGREE_LAT = (Math.PI / 180) * 6371;
const BOX_MARGIN = 1.01; // 1% slack; the exact distance check does the real filtering

/**
 * Cheap rectangle that fully contains the circle, used as a MongoDB
 * pre-filter (the collection has no geo index). The longitude span is widened
 * using the highest-latitude edge of the box, where a degree of longitude is
 * shortest, so the box is never smaller than the circle. The exact distance
 * check below does the real filtering.
 */
const boundingBox = ({ center, radiusKm }) => {
  const dLat = (radiusKm / KM_PER_DEGREE_LAT) * BOX_MARGIN;
  const maxAbsLat = Math.min(89, Math.abs(center.lat) + dLat);
  const dLng = ((radiusKm / (KM_PER_DEGREE_LAT * Math.cos((maxAbsLat * Math.PI) / 180))) * BOX_MARGIN);
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
};

/** MongoDB filter fragment for the bounding box. */
const boundingBoxFilter = (region) => {
  const b = boundingBox(region);
  return {
    "location.lat": { $gte: b.minLat, $lte: b.maxLat },
    "location.lng": { $gte: b.minLng, $lte: b.maxLng },
  };
};

/** Exact great-circle test: is the event within the region's radius? Bad coordinates → false. */
const isWithinRegion = (region, location) => {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return haversineDistance(region.center.lat, region.center.lng, lat, lng) <= region.radiusKm;
};

/** undefined / "" / "global" → null (no filtering). Unknown name → undefined (caller returns 400). */
const resolveRegion = (name) => {
  if (name === undefined || name === null || name === "" || String(name).toLowerCase() === "global") return null;
  return FEED_REGIONS[String(name).toLowerCase()];
};

module.exports = { FEED_REGIONS, boundingBox, boundingBoxFilter, isWithinRegion, resolveRegion };
