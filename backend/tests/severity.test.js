/**
 * Tests for POST /api/admin/emergencies/:id/severity
 *
 * Run from the backend folder:   npm test
 *
 * What is REAL here: the Express admin router, the JWT `protect` middleware, the
 * `authorize("admin")` role check, the severity controller and service, and axios.
 * What is STUBBED: the three Mongoose models (so no MongoDB is needed) and the Python
 * ML service (a tiny local HTTP server that records what it receives). These tests
 * therefore prove auth, validation, quake selection, error mapping and the read-only
 * guarantee — they do not exercise a real MongoDB or a real trained model.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

// ── Stub the Mongoose models before anything requires them ──────────────────
const stubModule = (relative, exports) => {
  const file = require.resolve(path.join(__dirname, "..", relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
};

const oid = (n) => n.toString(16).padStart(24, "0");
const NOW = new Date("2026-10-28T12:00:00Z");
const hoursBefore = (h) => new Date(NOW.getTime() - h * 3600 * 1000);

const ids = { admin: oid(101), user: oid(102), rescue: oid(103), inactiveAdmin: oid(104) };
const users = {
  [ids.admin]: { _id: ids.admin, role: "admin", isActive: true },
  [ids.user]: { _id: ids.user, role: "user", isActive: true },
  [ids.rescue]: { _id: ids.rescue, role: "rescue_team", isActive: true },
  [ids.inactiveAdmin]: { _id: ids.inactiveAdmin, role: "admin", isActive: false },
};
stubModule("models/User", { findById: (id) => ({ select: async () => users[id] || null }) });

// Any database write/unexpected read on Emergency is recorded; the endpoint must cause none.
const unexpectedEmergencyCalls = [];
const CHD = { lat: 30.7415, lng: 76.7878 };
const emergencies = {
  [oid(1)]: { _id: oid(1), type: "rescue", status: "pending", createdAt: NOW, location: CHD },
  [oid(2)]: { _id: oid(2), type: "safe", status: "resolved", createdAt: NOW, location: CHD },
  // Same place, but raised 40 h earlier: proves the SOS's own timestamp drives the time window.
  [oid(6)]: { _id: oid(6), type: "rescue", status: "pending", createdAt: hoursBefore(40), location: CHD },
  // Far from Chandigarh (eastern Nepal): proves the SOS's own coordinates drive the distance search.
  [oid(5)]: { _id: oid(5), type: "rescue", status: "pending", createdAt: NOW, location: { lat: 28.2, lng: 84.7 } },
  // Mid-ocean: nothing can match.
  [oid(8)]: { _id: oid(8), type: "rescue", status: "pending", createdAt: NOW, location: { lat: 0, lng: -140 } },
  // Corrupt records: nothing may be guessed.
  [oid(7)]: { _id: oid(7), type: "rescue", status: "pending", createdAt: NOW, location: {} },
  [oid(9)]: { _id: oid(9), type: "rescue", status: "pending", createdAt: NOW, location: { lat: 30.74, lng: null } },
};
const emergencyStub = { findById: async (id) => emergencies[id] || null };
["create", "find", "findOne", "findByIdAndUpdate", "updateOne", "updateMany", "deleteOne", "countDocuments", "aggregate"].forEach(
  (m) => {
    emergencyStub[m] = (...args) => {
      unexpectedEmergencyCalls.push(m);
      throw new Error(`Unexpected Emergency.${m}(${args.length} args)`);
    };
  }
);
stubModule("models/Emergency", emergencyStub);

// Feed rows. For the SOS at Chandigarh raised at NOW (default criteria: M >= 4.0, 300 km, 24 h):
//   matches  -> EXPECTED (M5.1), other-strong (M4.9), weaker-nearby (M4.4)
//   excluded -> everything else, each for a different reason (named in the eventId).
const ev = (eventId, magnitude, depth, lat, lng, time, alert = null) => ({
  eventId, magnitude, depth, location: { lat, lng }, time, alert, source: "usgs", place: eventId,
});
const feedRows = [
  ev("excluded-california-6.8", 6.8, 10, 37.8, -122.3, hoursBefore(1), "red"),
  ev("nepal-6.3-840km-from-chandigarh", 6.3, 15, 28.2, 84.7, hoursBefore(10)),
  ev("excluded-too-old-30h", 5.5, 10, 31.0, 77.0, hoursBefore(30)),
  ev("excluded-after-sos", 5.9, 10, 31.0, 77.5, new Date(NOW.getTime() + 2 * 3600 * 1000)),
  ev("excluded-too-small-3.2", 3.2, 10, 30.8, 76.9, hoursBefore(2)),
  { ...ev("excluded-no-depth", 5.6, undefined, 31.5, 78.0, hoursBefore(3)), depth: undefined },
  ev("weaker-nearby", 4.4, 10, 31.0, 77.0, hoursBefore(5)),
  ev("other-strong", 4.9, 8, 30.5, 76.5, hoursBefore(1)),
  ev("EXPECTED", 5.1, 18, 31.1, 77.17, hoursBefore(20), "yellow"),
  // Only relevant to the SOS raised 40 h ago (it happened 15 h before THAT SOS):
  ev("past-event-55h-ago", 5.0, 12, 30.9, 76.9, hoursBefore(55)),
];
const rowMatches = (row, filter) => {
  const t = row.time.getTime();
  if (filter.time && (t < filter.time.$gte.getTime() || t > filter.time.$lte.getTime())) return false;
  if (filter.magnitude && row.magnitude < filter.magnitude.$gte) return false;
  for (const key of ["location.lat", "location.lng"]) {
    const cond = filter[key];
    const value = row.location[key.split(".")[1]];
    if (cond && (value < cond.$gte || value > cond.$lte)) return false;
  }
  return true;
};
stubModule("models/EarthquakeFeed", {
  find: (filter) => {
    let rows = feedRows.filter((r) => rowMatches(r, filter));
    const chain = {
      sort: (spec) => {
        const [[field, dir]] = Object.entries(spec);
        rows = [...rows].sort((a, b) => (dir === -1 ? b[field] - a[field] : a[field] - b[field]));
        return chain;
      },
      limit: (n) => {
        rows = rows.slice(0, n);
        return chain;
      },
      lean: async () => rows,
    };
    return chain;
  },
});

// ── Mock ML service ─────────────────────────────────────────────────────────
let mlMode = "ok";
let mlCalls = [];
const mlServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    mlCalls.push({ method: req.method, url: req.url, body });
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (mlMode === "untrained") return send(503, { success: false, code: "MODEL_NOT_TRAINED", message: "No trained model found." });
    if (mlMode === "invalid") return send(400, { success: false, code: "INVALID_INPUT", message: "'magnitude' must be between 0.0 and 10.0" });
    if (mlMode === "crash") return send(500, { error: "boom" });
    send(200, {
      success: true,
      predictedClass: "moderate",
      label: "Moderate",
      confidence: 0.7,
      probabilities: { low: 0.2, moderate: 0.7, high: 0.1 },
      inputs: body,
      featureImportances: [{ feature: "magnitude", importance: 0.6 }],
      explanation: ["stub"],
      warnings: [],
      model: { type: "stub" },
    });
  });
});

// ── App under test: the REAL admin router ───────────────────────────────────
const express = require("express");
const jwt = require("jsonwebtoken");
const errorHandler = require("../middleware/errorHandler");
let appServer;
let base;

test.before(async () => {
  await new Promise((r) => mlServer.listen(0, "127.0.0.1", r));
  process.env.ML_SERVICE_URL = `http://127.0.0.1:${mlServer.address().port}`;

  const app = express();
  app.use(express.json());
  app.use("/api/admin", require("../routes/admin"));
  app.use(errorHandler);
  appServer = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  base = `http://127.0.0.1:${appServer.address().port}/api/admin`;
});

test.after(() => {
  appServer.close();
  mlServer.close();
});

test.beforeEach(() => {
  mlMode = "ok";
  mlCalls = [];
});

const token = (id) => jwt.sign({ id }, process.env.JWT_SECRET);
const post = async (emergencyId, { as, body, auth } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (auth !== undefined) headers.Authorization = auth;
  else if (as) headers.Authorization = `Bearer ${token(ids[as])}`;
  const res = await fetch(`${base}/emergencies/${emergencyId}/severity`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json() };
};

// ── Authentication / authorization ──────────────────────────────────────────
test("401 without a token", async () => {
  const { status, json } = await post(oid(1));
  assert.equal(status, 401);
  assert.equal(json.success, false);
  assert.equal(mlCalls.length, 0);
});

test("401 with a malformed or wrongly-signed token", async () => {
  assert.equal((await post(oid(1), { auth: "Bearer not.a.jwt" })).status, 401);
  const forged = jwt.sign({ id: ids.admin }, "some-other-secret");
  assert.equal((await post(oid(1), { auth: `Bearer ${forged}` })).status, 401);
  assert.equal(mlCalls.length, 0);
});

test("401 for a deactivated admin account", async () => {
  assert.equal((await post(oid(1), { as: "inactiveAdmin" })).status, 401);
});

test("403 for a normal user (victim) — victim workflow cannot reach it", async () => {
  const { status, json } = await post(oid(1), { as: "user" });
  assert.equal(status, 403);
  assert.match(json.message, /admin/i);
  assert.equal(mlCalls.length, 0);
});

test("403 for a rescue-team account (endpoint is admin-only)", async () => {
  assert.equal((await post(oid(1), { as: "rescue" })).status, 403);
  assert.equal(mlCalls.length, 0);
});

// ── Request validation ──────────────────────────────────────────────────────
test("400 for an invalid emergency id", async () => {
  const { status, json } = await post("not-an-id", { as: "admin" });
  assert.equal(status, 400);
  assert.match(json.message, /invalid emergency id/i);
});

test("404 for an unknown emergency", async () => {
  assert.equal((await post(oid(999), { as: "admin" })).status, 404);
});

test("400 for a non-rescue (I'm Safe) record", async () => {
  const { status, json } = await post(oid(2), { as: "admin" });
  assert.equal(status, 400);
  assert.match(json.message, /rescue SOS/i);
  assert.equal(mlCalls.length, 0);
});

test("400 for a malformed manual scenario, without calling the ML service", async () => {
  for (const scenario of [{ magnitude: "6", depth: 10, latitude: 30, longitude: 76 }, { magnitude: 6 }, "x", null]) {
    const { status, json } = await post(oid(1), { as: "admin", body: { scenario } });
    assert.equal(status, 400, JSON.stringify(scenario));
    assert.equal(json.code, "INVALID_INPUT");
  }
  assert.equal(mlCalls.length, 0);
});

// ── Happy paths ─────────────────────────────────────────────────────────────
test("200: matches by the SOS's own location + time, picks the strongest, and reports distance/time", async () => {
  const { status, json } = await post(oid(1), { as: "admin" });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.advisory, true);
  assert.equal(json.source, "feed");
  assert.equal(json.quake.eventId, "EXPECTED");
  assert.equal(json.quake.officialAlert, "yellow");
  // time: the quake was 20 h before the SOS
  assert.equal(json.quake.minutesBeforeSos, 20 * 60);
  // distance: great-circle from the SOS (not from a fixed Chandigarh point) — recomputed independently
  const { haversineDistance } = require("../utils/geoUtils");
  const expectedKm = haversineDistance(CHD.lat, CHD.lng, 31.1, 77.17);
  assert.ok(Math.abs(json.quake.distanceKm - expectedKm) < 0.06, `${json.quake.distanceKm} vs ${expectedKm}`);
  assert.ok(json.quake.distanceKm > 40 && json.quake.distanceKm < 80);
  // the model received exactly the matched event's parameters
  assert.deepEqual(mlCalls[0].body, { magnitude: 5.1, depth: 18, latitude: 31.1, longitude: 77.17 });
  assert.equal(json.prediction.predictedClass, "moderate");
  assert.equal(json.prediction.success, undefined); // ML envelope flag is not leaked into the payload
  assert.match(json.disclaimer, /does not assign teams, change emergency status, or set rescue priority/);
});

test("the matching criteria, other candidates and SOS context are disclosed", async () => {
  const { json } = await post(oid(1), { as: "admin" });
  assert.deepEqual(
    { r: json.matching.radiusKm, w: json.matching.windowHours, m: json.matching.minMagnitude },
    { r: 300, w: 24, m: 4 }
  );
  assert.equal(json.matching.candidatesConsidered, 3);
  assert.deepEqual(json.otherCandidates.map((c) => c.eventId), ["other-strong", "weaker-nearby"]);
  assert.ok(json.otherCandidates.every((c) => Number.isFinite(c.distanceKm) && Number.isFinite(c.minutesBeforeSos)));
  assert.deepEqual(json.matching.sosLocation, CHD);
  assert.equal(new Date(json.matching.sosCreatedAt).getTime(), NOW.getTime());
});

test("matching uses the SOS's OWN coordinates: an SOS in Nepal matches the Nepal quake, not Chandigarh's", async () => {
  const { json } = await post(oid(5), { as: "admin" });
  assert.equal(json.quake.eventId, "nepal-6.3-840km-from-chandigarh");
  assert.ok(json.quake.distanceKm < 1);
  assert.equal(json.quake.minutesBeforeSos, 10 * 60);
  assert.deepEqual(json.otherCandidates, []);
});

test("matching uses the SOS's OWN timestamp: an SOS raised 40 h ago matches a quake from before it, never one after it", async () => {
  const { json } = await post(oid(6), { as: "admin" });
  assert.equal(json.quake.eventId, "past-event-55h-ago");
  assert.equal(json.quake.minutesBeforeSos, 15 * 60);
  const everyId = [json.quake, ...json.otherCandidates].map((c) => c.eventId);
  assert.ok(!everyId.includes("EXPECTED")); // happened 20 h AFTER that SOS was raised
});

test("200 with no prediction and an honest message when nothing matches (no ML call)", async () => {
  const { status, json } = await post(oid(8), { as: "admin" });
  assert.equal(status, 200);
  assert.equal(json.prediction, null);
  assert.equal(json.quake, null);
  assert.equal(json.code, "NO_MATCHING_EARTHQUAKE");
  assert.match(json.message, /magnitude 4\+ was found within 300 km of this SOS in the 24 hours before/);
  assert.match(json.message, /does not prove none occurred/);
  assert.equal(json.matching.candidatesConsidered, 0);
  assert.equal(mlCalls.length, 0);
});

test("never guesses: an SOS with a missing/partial location cannot be matched", async () => {
  for (const id of [oid(7), oid(9)]) {
    const { status, json } = await post(id, { as: "admin" });
    assert.equal(status, 200);
    assert.equal(json.prediction, null);
    assert.equal(json.code, "SOS_LOCATION_UNAVAILABLE");
  }
  assert.equal(mlCalls.length, 0);
});

test("criteria are configurable via env (min magnitude 5.0 keeps only the M5.1 event)", async () => {
  process.env.SEVERITY_MIN_MAGNITUDE = "5.0";
  try {
    const { json } = await post(oid(1), { as: "admin" });
    assert.equal(json.quake.eventId, "EXPECTED");
    assert.deepEqual(json.otherCandidates, []);
    assert.equal(json.matching.minMagnitude, 5);
  } finally {
    delete process.env.SEVERITY_MIN_MAGNITUDE;
  }
});

test("invalid env values fall back to the documented defaults", () => {
  const { matchingCriteria } = require("../services/severityService");
  const saved = { ...process.env };
  Object.assign(process.env, { SEVERITY_MATCH_RADIUS_KM: "abc", SEVERITY_QUAKE_WINDOW_HOURS: "-5", SEVERITY_MIN_MAGNITUDE: "" });
  try {
    assert.deepEqual(matchingCriteria(), { radiusKm: 300, windowHours: 24, minMagnitude: 4 });
  } finally {
    for (const k of ["SEVERITY_MATCH_RADIUS_KM", "SEVERITY_QUAKE_WINDOW_HOURS", "SEVERITY_MIN_MAGNITUDE"]) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

test("200: manual what-if scenario is sent to the ML service as given", async () => {
  const scenario = { magnitude: 6.4, depth: 12, latitude: 30.74, longitude: 76.79 };
  const { status, json } = await post(oid(1), { as: "admin", body: { scenario, extra: "ignored" } });
  assert.equal(status, 200);
  assert.equal(json.source, "manual");
  assert.equal(json.quake, null);
  assert.deepEqual(mlCalls[0].body, scenario);
});

// ── ML service failures are reported honestly ───────────────────────────────
test("ML 400 (e.g. out-of-range magnitude) → 400 with the ML message", async () => {
  mlMode = "invalid";
  const { status, json } = await post(oid(1), { as: "admin", body: { scenario: { magnitude: 99, depth: 1, latitude: 1, longitude: 1 } } });
  assert.equal(status, 400);
  assert.equal(json.code, "INVALID_INPUT");
  assert.match(json.message, /magnitude/);
});

test("model not trained → 503 MODEL_NOT_TRAINED", async () => {
  mlMode = "untrained";
  const { status, json } = await post(oid(1), { as: "admin" });
  assert.equal(status, 503);
  assert.equal(json.code, "MODEL_NOT_TRAINED");
});

test("ML service crash → 502 ML_SERVICE_ERROR", async () => {
  mlMode = "crash";
  const { status, json } = await post(oid(1), { as: "admin" });
  assert.equal(status, 502);
  assert.equal(json.code, "ML_SERVICE_ERROR");
});

test("ML service not running → 503 ML_SERVICE_UNAVAILABLE", async () => {
  const saved = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = "http://127.0.0.1:1"; // nothing listens here
  try {
    const { status, json } = await post(oid(1), { as: "admin" });
    assert.equal(status, 503);
    assert.equal(json.code, "ML_SERVICE_UNAVAILABLE");
  } finally {
    process.env.ML_SERVICE_URL = saved;
  }
});

// ── Advisory-only guarantee ─────────────────────────────────────────────────
test("the endpoint never writes to or queries Emergency beyond findById (advisory only)", () => {
  assert.deepEqual(unexpectedEmergencyCalls, []);
});

test("existing admin routes are still mounted and still protected", async () => {
  for (const [method, url] of [
    ["GET", "/emergencies"],
    ["GET", "/stats"],
    ["GET", "/rescue-teams"],
    ["PATCH", `/emergencies/${oid(1)}/assign`],
    ["PATCH", `/emergencies/${oid(1)}/status`],
  ]) {
    const res = await fetch(base + url, { method });
    assert.equal(res.status, 401, `${method} ${url}`);
  }
});
