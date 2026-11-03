/**
 * Haversine distance calculation between two lat/lng points
 * Returns distance in kilometres
 */
const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Find the nearest item from a list using haversine distance
 * @param {number} userLat
 * @param {number} userLng
 * @param {Array} items - array of objects with location.lat and location.lng
 * @returns {{ item, distance }}
 */
const findNearest = (userLat, userLng, items) => {
  if (!items || items.length === 0) return null;
  let nearest = null;
  let minDist = Infinity;
  for (const item of items) {
    const d = haversineDistance(userLat, userLng, item.location.lat, item.location.lng);
    if (d < minDist) {
      minDist = d;
      nearest = item;
    }
  }
  return { item: nearest, distance: minDist };
};

/**
 * Check if coordinates are valid
 */
const isValidCoords = (lat, lng) =>
  typeof lat === "number" &&
  typeof lng === "number" &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180;

// ---------------------------------------------------------------------------
// Chandigarh operational region / geofence
//
// The application's operational area is Chandigarh, India. Rather than a
// centre-point + radius approximation, we load a real (simplified) boundary
// polygon and do point-in-polygon containment checks against it. See
// backend/data/chandigarh-boundary.geojson for provenance/accuracy notes —
// it is an MVP-grade approximation, not a survey-grade boundary.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");

const BOUNDARY_PATH = path.join(__dirname, "..", "data", "chandigarh-boundary.geojson");

let _boundaryGeoJSON = null;
let _boundaryPolygon = null; // array of [lng, lat] pairs, outer ring only
let _boundaryBounds = null; // { north, south, east, west }

const loadChandigarhBoundary = () => {
  if (_boundaryGeoJSON) return _boundaryGeoJSON;
  const raw = fs.readFileSync(BOUNDARY_PATH, "utf-8");
  _boundaryGeoJSON = JSON.parse(raw);
  const ring = _boundaryGeoJSON.features[0].geometry.coordinates[0];
  _boundaryPolygon = ring;

  let north = -90, south = 90, east = -180, west = 180;
  for (const [lng, lat] of ring) {
    if (lat > north) north = lat;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lng < west) west = lng;
  }
  _boundaryBounds = { north, south, east, west };

  return _boundaryGeoJSON;
};

/**
 * Ray-casting point-in-polygon test.
 * @param {number} lat
 * @param {number} lng
 * @param {Array<[number, number]>} ring - array of [lng, lat] pairs (outer ring)
 */
const pointInPolygon = (lat, lng, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i];
    const [lngJ, latJ] = ring[j];
    const intersects =
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (intersects) inside = !inside;
  }
  return inside;
};

/**
 * Whether a GPS coordinate falls inside the Chandigarh operational boundary.
 */
const isInsideChandigarh = (lat, lng) => {
  if (!isValidCoords(lat, lng)) return false;
  loadChandigarhBoundary();
  return pointInPolygon(lat, lng, _boundaryPolygon);
};

/** Bounding box of the Chandigarh boundary, useful for map fitBounds(). */
const getChandigarhBounds = () => {
  loadChandigarhBoundary();
  return _boundaryBounds;
};

/** Raw boundary GeoJSON, for handing to the frontend / map overlay. */
const getChandigarhBoundaryGeoJSON = () => {
  return loadChandigarhBoundary();
};

const CHANDIGARH_CENTER = { lat: 30.7333, lng: 76.7794 };

module.exports = {
  haversineDistance,
  findNearest,
  isValidCoords,
  isInsideChandigarh,
  getChandigarhBounds,
  getChandigarhBoundaryGeoJSON,
  CHANDIGARH_CENTER,
};
