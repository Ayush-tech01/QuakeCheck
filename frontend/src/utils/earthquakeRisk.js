import { CHANDIGARH_CENTER } from "../config/region";

/**
 * QUAKECHECK RISK — a transparent, rule-based, PROJECT-LEVEL regional assessment.
 *
 * !! This is NOT earthquake prediction. !!
 * It says nothing about future earthquakes. It takes an earthquake that USGS
 * has ALREADY detected and estimates how relevant it may be to the Chandigarh
 * operational region, using only the event's own data. The thresholds below
 * are project design choices that are easy to explain — they are not
 * scientifically validated hazard thresholds, and no ML / external AI is used.
 *
 * It is a THIRD, separate signal next to the existing ones, and replaces
 * neither: magnitude class (Minor…Great) and the USGS PAGER alert badge
 * (Low/Moderate/High/Severe) are still shown as before.
 *
 * The same function (assessQuake) feeds the earthquake card, the map popup,
 * the dashboard alert and the safety panel, so they can never disagree.
 *
 * ── How the score works (0–100, deterministic) ───────────────────────────
 *   magnitude  0–50  linear from M3.0 (0) to M7.5+ (50)
 *   distance   0–30  haversine km from Chandigarh:
 *                    ≤50 km 30 · 150 km 22 · 300 km 12 · 600 km 3 · ≥1000 km 0
 *                    (linear between those points)
 *   depth      0–10  shallow quakes shake the surface harder:
 *                    ≤15 km 10 · 70 km 5 · ≥200 km 0   (missing depth → 5)
 *   USGS alert 0–10  supporting signal only: none/green 0 · yellow 3 ·
 *                    orange 6 · red 10
 *
 *   score <35 LOW · 35–49 MODERATE · 50–69 HIGH · ≥70 CRITICAL
 *
 * ── Guardrails (so a big number can't mislead) ────────────────────────────
 *   • Magnitude gates: HIGH needs M ≥ 5.0, CRITICAL needs M ≥ 6.0. A small
 *     quake is never HIGH however close it is.
 *   • Distance caps: beyond 300 km the level is capped at HIGH, beyond
 *     600 km at MODERATE, beyond 1000 km at LOW. A huge quake thousands of km
 *     away is therefore informational, never CRITICAL.
 *   • Far-field rule: beyond 600 km, MODERATE needs M ≥ 6.5 (otherwise LOW) —
 *     distant quakes only matter when they are very large.
 *   • Incomplete data is never guessed: no usable magnitude or coordinates →
 *     not assessed (level null). Missing depth gets a neutral value, missing
 *     alert simply adds 0.
 */

const [CHD_LAT, CHD_LNG] = CHANDIGARH_CENTER; // single existing Chandigarh reference

export const LEVEL_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

// Presentation config per level (badge classes already exist in index.css).
export const RISK_LEVELS = {
  LOW:      { label: "LOW",      badgeClass: "badge-green",  color: "#22c55e" },
  MODERATE: { label: "MODERATE", badgeClass: "badge-yellow", color: "#eab308" },
  HIGH:     { label: "HIGH",     badgeClass: "badge-red",    color: "#f97316" },
  CRITICAL: { label: "CRITICAL", badgeClass: "badge-red",    color: "#ef4444" },
};

const SCORE_THRESHOLDS = { MODERATE: 35, HIGH: 50, CRITICAL: 70 };
const FAR_FIELD = { beyondKm: 600, minMagnitudeForModerate: 6.5 };
const MIN_MAGNITUDE_FOR = { HIGH: 5.0, CRITICAL: 6.0 };
// First matching rule wins (largest distance first).
const DISTANCE_CAPS = [
  { beyondKm: 1000, max: "LOW" },
  { beyondKm: 600, max: "MODERATE" },
  { beyondKm: 300, max: "HIGH" },
];
const ALERT_POINTS = { green: 0, yellow: 3, orange: 6, red: 10 };
const NEUTRAL_DEPTH_POINTS = 5;

/** Only quakes at/above this magnitude can ever be HIGH/CRITICAL → the dashboard scan can ask the API for just these. */
export const RISK_SCAN_MIN_MAGNITUDE = MIN_MAGNITUDE_FOR.HIGH;
/** The dashboard/safety alert only considers quakes this recent (the USGS feed is "last 24 h"). */
export const ALERT_WINDOW_HOURS = 24;

// ── helpers ────────────────────────────────────────────────────────────
const toNum = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Piecewise-linear interpolation; clamps to the first/last point. */
function interpolate(x, points) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/** Valid = finite numbers within real lat/lng ranges. Negative values are fine (southern/western hemispheres). */
export function hasValidCoords(lat, lng) {
  const a = toNum(lat), b = toNum(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
}

/** Great-circle distance in km (haversine) from the Chandigarh reference point. */
export function distanceFromChandigarhKm(lat, lng) {
  if (!hasValidCoords(lat, lng)) return null;
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat - CHD_LAT);
  const dLng = rad(lng - CHD_LNG);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(CHD_LAT)) * Math.cos(rad(lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatKm(km) {
  if (!Number.isFinite(km)) return "—";
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

export const isElevated = (level) => level === "HIGH" || level === "CRITICAL";

const capLevel = (level, max) =>
  LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(max) ? max : level;

// ── main entry ─────────────────────────────────────────────────────────
/**
 * @param quake  { magnitude, depth, alert, location: { lat, lng } }  (EarthquakeFeed document)
 * @returns {{ assessed: boolean, level: string|null, score: number|null,
 *             distanceKm: number|null, factors: object|null, notes: string[] }}
 * Never throws; incomplete data yields assessed:false (distanceKm is still
 * returned whenever the coordinates are usable).
 */
export function assessQuake(quake) {
  const lat = quake?.location?.lat;
  const lng = quake?.location?.lng;
  const distanceKm = distanceFromChandigarhKm(lat, lng);
  const magnitude = toNum(quake?.magnitude);

  if (!Number.isFinite(magnitude) || magnitude < 0 || distanceKm === null) {
    return {
      assessed: false, level: null, score: null, distanceKm, factors: null,
      notes: [!Number.isFinite(magnitude) || magnitude < 0 ? "No usable magnitude" : "No usable coordinates"],
    };
  }

  const depth = toNum(quake?.depth);
  const notes = [];

  const magnitudePts = 50 * clamp01((magnitude - 3.0) / (7.5 - 3.0));
  const distancePts = interpolate(distanceKm, [[50, 30], [150, 22], [300, 12], [600, 3], [1000, 0]]);
  let depthPts;
  if (Number.isFinite(depth) && depth >= 0) {
    depthPts = interpolate(depth, [[15, 10], [70, 5], [200, 0]]);
  } else {
    depthPts = NEUTRAL_DEPTH_POINTS;
    notes.push("Depth unavailable — neutral value used");
  }
  const alertPts = ALERT_POINTS[quake?.alert] ?? 0;

  const score = Math.min(100, magnitudePts + distancePts + depthPts + alertPts);

  let level = "LOW";
  if (score >= SCORE_THRESHOLDS.CRITICAL) level = "CRITICAL";
  else if (score >= SCORE_THRESHOLDS.HIGH) level = "HIGH";
  else if (score >= SCORE_THRESHOLDS.MODERATE) level = "MODERATE";

  // Guardrail 1: magnitude gates
  if (level === "CRITICAL" && magnitude < MIN_MAGNITUDE_FOR.CRITICAL) {
    level = "HIGH";
    notes.push(`Below M${MIN_MAGNITUDE_FOR.CRITICAL} — not CRITICAL`);
  }
  if (level === "HIGH" && magnitude < MIN_MAGNITUDE_FOR.HIGH) {
    level = "MODERATE";
    notes.push(`Below M${MIN_MAGNITUDE_FOR.HIGH} — not HIGH`);
  }
  // Guardrail 2: distance caps
  const cap = DISTANCE_CAPS.find((c) => distanceKm > c.beyondKm);
  if (cap) {
    const capped = capLevel(level, cap.max);
    if (capped !== level) notes.push(`More than ${cap.beyondKm} km away — capped at ${cap.max}`);
    level = capped;
  }
  // Guardrail 3: far-field rule
  if (distanceKm > FAR_FIELD.beyondKm && level === "MODERATE" && magnitude < FAR_FIELD.minMagnitudeForModerate) {
    level = "LOW";
    notes.push(`More than ${FAR_FIELD.beyondKm} km away and below M${FAR_FIELD.minMagnitudeForModerate} — LOW`);
  }

  return {
    assessed: true,
    level,
    score: Math.round(score),
    distanceKm,
    factors: {
      magnitude: Math.round(magnitudePts),
      distance: Math.round(distancePts),
      depth: Math.round(depthPts),
      alert: alertPts,
    },
    notes,
  };
}

// ── list helpers (dashboard alert / safety panel) ──────────────────────
/** Drops duplicate events (same eventId; falls back to time+coords). Keeps the first occurrence. */
export function dedupeQuakes(quakes) {
  const seen = new Set();
  return (quakes || []).filter((q) => {
    if (!q) return false;
    const key = q.eventId || `${q.time}|${q.location?.lat}|${q.location?.lng}|${q.magnitude}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * HIGH / CRITICAL quakes from the last `windowHours`, most significant first.
 * Older events keep their badge on the card/map but don't trigger alerts.
 * @returns {{ quake, risk }[]}
 */
export function getElevatedQuakes(quakes, { windowHours = ALERT_WINDOW_HOURS, now = Date.now() } = {}) {
  const cutoff = now - windowHours * 3600 * 1000;
  return dedupeQuakes(quakes)
    .filter((q) => {
      const t = new Date(q.time).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .map((quake) => ({ quake, risk: assessQuake(quake) }))
    .filter(({ risk }) => risk.assessed && isElevated(risk.level))
    .sort((a, b) => b.risk.score - a.risk.score || new Date(b.quake.time) - new Date(a.quake.time));
}
