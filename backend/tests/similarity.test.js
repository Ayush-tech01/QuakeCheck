/**
 * Tests for POST /api/admin/emergencies/:id/similar-earthquakes  (historical earthquake similarity, KNN)
 *
 * Run from the backend folder:   npm test      (runs this file and tests/severity.test.js)
 *
 * Same approach as tests/severity.test.js. What is REAL here: the Express admin router, the JWT
 * `protect` middleware, the `authorize("admin")` role check, the similarity controller/service, the
 * existing severity matching code it reuses, and axios. What is STUBBED: the three Mongoose models
 * (no MongoDB needed) and the Python ML service (a tiny local HTTP server that records what it
 * receives and replays canned responses). So these tests prove auth, validation, quake selection,
 * error mapping and the read-only / independent-of-Random-Forest guarantees. They do NOT exercise a
 * real MongoDB or the real KNN — the KNN itself is covered by ml-service/tests/test_similarity.py.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  // Raised 40 h earlier: proves the SOS's own timestamp drives the time window.
  [oid(6)]: { _id: oid(6), type: "rescue", status: "pending", createdAt: hoursBefore(40), location: CHD },
  // Eastern Nepal: proves the SOS's own coordinates drive the distance search.
  [oid(5)]: { _id: oid(5), type: "rescue", status: "pending", createdAt: NOW, location: { lat: 28.2, lng: 84.7 } },
  // Mid-ocean: nothing can match, and no unrelated quake may be substituted.
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

// Same feed fixture shape as severity.test.js. For the SOS at Chandigarh raised at NOW the strongest
// qualifying event is "EXPECTED" (M5.1); everything else is excluded for the reason in its eventId.
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

// ── Mock ML service (answers BOTH /predict and /similar, like the real one) ─
let mlMode = "ok";
let mlCalls = [];
const fakeMatch = (rank) => ({
  rank, eventId: `hist-${rank}`, time: "2015-04-25T06:11:26Z", place: `Historical place ${rank}`,
  magnitude: 5 + rank / 10, depth: 10 + rank, latitude: 30 + rank, longitude: 77 + rank, distanceKm: 100 * rank,
  magnitudeDifference: 0.1 * rank, depthDifferenceKm: rank, matchDistance: 0.1 * rank,
  historicalPagerAlert: "yellow", historicalPagerLabel: "Yellow (PAGER)",
});
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
    if (req.url === "/predict") {
      return send(200, {
        success: true, predictedClass: "moderate", label: "Moderate", confidence: 0.7,
        probabilities: { low: 0.2, moderate: 0.7, high: 0.1 }, inputs: body,
        featureImportances: [{ feature: "magnitude", importance: 0.6 }], explanation: ["stub"], warnings: [], model: { type: "stub" },
      });
    }
    if (mlMode === "invalid") return send(400, { success: false, code: "INVALID_INPUT", message: "'magnitude' must be between 0.0 and 10.0" });
    if (mlMode === "dataMissing") return send(503, { success: false, code: "HISTORICAL_DATA_NOT_AVAILABLE", message: "The historical earthquake dataset has not been downloaded." });
    if (mlMode === "dataEmpty") return send(503, { success: false, code: "HISTORICAL_DATA_EMPTY", message: "The historical earthquake dataset contains no usable records." });
    if (mlMode === "weird503") return send(503, { success: false, code: "SOMETHING_ELSE", message: "internal detail /srv/secret/path" });
    if (mlMode === "oldService") return send(404, "<h1>Not Found</h1>");
    if (mlMode === "crash") return send(500, { success: false, code: "SIMILARITY_FAILED", message: "internal detail /srv/secret/path" });
    const matches = mlMode === "few" ? [fakeMatch(1), fakeMatch(2)] : [1, 2, 3, 4, 5].map(fakeMatch);
    send(200, {
      success: true, inputs: body, k: 5, returned: matches.length, matches,
      message: mlMode === "few" ? "Only 2 valid historical record(s) were available, so fewer than 5 matches are shown." : null,
      excludedCurrentEvent: 0, method: { algorithm: "stub" }, reference: { records: 1234, synthetic: false }, warnings: [], disclaimer: "stub",
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
const call = async (suffix, emergencyId, { as, body, auth } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (auth !== undefined) headers.Authorization = auth;
  else if (as) headers.Authorization = `Bearer ${token(ids[as])}`;
  const res = await fetch(`${base}/emergencies/${emergencyId}/${suffix}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json() };
};
const similar = (emergencyId, opts) => call("similar-earthquakes", emergencyId, opts);
const severity = (emergencyId, opts) => call("severity", emergencyId, opts);
const similarCalls = () => mlCalls.filter((c) => c.url === "/similar");

// ── Authentication / authorization ──────────────────────────────────────────
test("401 without a token", async () => {
  const { status, json } = await similar(oid(1));
  assert.equal(status, 401);
  assert.equal(json.success, false);
  assert.equal(mlCalls.length, 0);
});

test("401 with a malformed or wrongly-signed token", async () => {
  assert.equal((await similar(oid(1), { auth: "Bearer not.a.jwt" })).status, 401);
  const forged = jwt.sign({ id: ids.admin }, "some-other-secret");
  assert.equal((await similar(oid(1), { auth: `Bearer ${forged}` })).status, 401);
  assert.equal(mlCalls.length, 0);
});

test("401 for a deactivated admin account", async () => {
  assert.equal((await similar(oid(1), { as: "inactiveAdmin" })).status, 401);
  assert.equal(mlCalls.length, 0);
});

test("403 for a normal user (victim) — the victim workflow cannot reach it", async () => {
  const { status, json } = await similar(oid(1), { as: "user" });
  assert.equal(status, 403);
  assert.match(json.message, /admin/i);
  assert.equal(mlCalls.length, 0);
});

test("403 for a rescue-team account (admin-only)", async () => {
  assert.equal((await similar(oid(1), { as: "rescue" })).status, 403);
  assert.equal(mlCalls.length, 0);
});

// ── Validation ──────────────────────────────────────────────────────────────
test("400 for an invalid emergency id, 404 for an unknown one, 400 for a non-rescue (I'm Safe) record", async () => {
  assert.equal((await similar("not-an-id", { as: "admin" })).status, 400);
  assert.equal((await similar(oid(999), { as: "admin" })).status, 404);
  const safe = await similar(oid(2), { as: "admin" });
  assert.equal(safe.status, 400);
  assert.match(safe.json.message, /rescue SOS/);
  assert.equal(mlCalls.length, 0);
});

test("400 for a malformed hypothetical scenario, without calling the ML service", async () => {
  for (const scenario of [{ magnitude: "6", depth: 10, latitude: 30, longitude: 76 }, { magnitude: 6 }, "x", null]) {
    const { status, json } = await similar(oid(1), { as: "admin", body: { scenario } });
    assert.equal(status, 400, JSON.stringify(scenario));
    assert.equal(json.code, "INVALID_INPUT");
  }
  assert.equal(mlCalls.length, 0);
});

// ── Matched-earthquake flow ─────────────────────────────────────────────────
test("200: analyses the SAME earthquake as the severity panel and sends it to the ML service /similar", async () => {
  const sev = await severity(oid(1), { as: "admin" });
  mlCalls = [];
  const { status, json } = await similar(oid(1), { as: "admin" });

  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.informational, true);
  assert.equal(json.source, "feed");
  assert.equal(json.hypothetical, false);
  assert.equal(json.quake.eventId, "EXPECTED");
  assert.equal(json.quake.eventId, sev.json.quake.eventId, "both panels must analyse the same earthquake");
  assert.equal(json.similarity.matches.length, 5);
  assert.equal(json.similarity.matches[0].historicalPagerAlert, "yellow");

  assert.equal(similarCalls().length, 1);
  assert.equal(mlCalls.length, 1);
  const sent = similarCalls()[0].body;
  assert.deepEqual(
    { magnitude: sent.magnitude, depth: sent.depth, latitude: sent.latitude, longitude: sent.longitude, eventId: sent.eventId },
    { magnitude: 5.1, depth: 18, latitude: 31.1, longitude: 77.17, eventId: "EXPECTED" }
  );
  assert.equal(sent.time, hoursBefore(20).toISOString());
});

test("the response carries no Random Forest prediction and the disclaimer separates the two analyses", async () => {
  const { json } = await similar(oid(1), { as: "admin" });
  for (const key of ["prediction", "predictedClass", "probabilities", "advisory"]) {
    assert.equal(json[key], undefined, key);
  }
  assert.match(json.disclaimer, /does not predict/);
  assert.match(json.disclaimer, /separate from the Random Forest/);
  assert.match(json.disclaimer, /does not assign teams/);
});

test("matching criteria and SOS context are disclosed", async () => {
  const { json } = await similar(oid(1), { as: "admin" });
  assert.deepEqual(
    { r: json.matching.radiusKm, w: json.matching.windowHours, m: json.matching.minMagnitude, n: json.matching.candidatesConsidered },
    { r: 300, w: 24, m: 4, n: 3 }
  );
  assert.deepEqual(json.matching.sosLocation, CHD);
});

test("matching uses the SOS's OWN coordinates and timestamp (same rules as the severity panel)", async () => {
  const nepal = await similar(oid(5), { as: "admin" });
  assert.equal(nepal.json.quake.eventId, "nepal-6.3-840km-from-chandigarh");
  const past = await similar(oid(6), { as: "admin" });
  assert.equal(past.json.quake.eventId, "past-event-55h-ago");   // never the quake that happened AFTER that SOS
});

test("200 with no similarity and an honest message when no earthquake matches — nothing substituted, no ML call", async () => {
  const { status, json } = await similar(oid(8), { as: "admin" });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.quake, null);
  assert.equal(json.similarity, null);
  assert.equal(json.code, "NO_MATCHING_EARTHQUAKE");
  assert.match(json.message, /needs a matched earthquake/);
  assert.match(json.message, /hypothetical scenario/);
  assert.equal(mlCalls.length, 0);
});

test("never guesses: an SOS with a missing/partial location cannot be matched", async () => {
  const noLoc = await similar(oid(7), { as: "admin" });
  assert.equal(noLoc.json.code, "SOS_LOCATION_UNAVAILABLE");
  assert.equal(noLoc.json.similarity, null);
  const partial = await similar(oid(9), { as: "admin" });
  assert.equal(partial.json.code, "SOS_LOCATION_UNAVAILABLE");
  assert.equal(mlCalls.length, 0);
});

// ── Hypothetical scenario ───────────────────────────────────────────────────
test("200: a hypothetical scenario is clearly labelled, never presented as a real earthquake, and sent as given", async () => {
  const scenario = { magnitude: 6.5, depth: 10, latitude: 30.7, longitude: 76.8 };
  const { status, json } = await similar(oid(8), { as: "admin", body: { scenario } });   // works even with no matched quake
  assert.equal(status, 200);
  assert.equal(json.source, "manual");
  assert.equal(json.hypothetical, true);
  assert.equal(json.quake, null);
  assert.equal(json.matching, null);
  assert.equal(json.similarity.matches.length, 5);
  assert.deepEqual(similarCalls()[0].body, scenario);     // no eventId / time invented for a what-if
});

// ── Few results, and failure mapping ────────────────────────────────────────
test("fewer than five matches: the ML service's explanation is passed through unchanged", async () => {
  mlMode = "few";
  const { status, json } = await similar(oid(1), { as: "admin" });
  assert.equal(status, 200);
  assert.equal(json.similarity.matches.length, 2);
  assert.match(json.similarity.message, /fewer than 5/);
});

test("ML 400 (e.g. out-of-range magnitude) → 400 with the ML message", async () => {
  mlMode = "invalid";
  const { status, json } = await similar(oid(1), { as: "admin" });
  assert.equal(status, 400);
  assert.equal(json.code, "INVALID_INPUT");
  assert.match(json.message, /magnitude/);
});

test("historical dataset missing / empty → 503 with the dataset code", async () => {
  mlMode = "dataMissing";
  let r = await similar(oid(1), { as: "admin" });
  assert.deepEqual([r.status, r.json.code], [503, "HISTORICAL_DATA_NOT_AVAILABLE"]);
  mlMode = "dataEmpty";
  r = await similar(oid(1), { as: "admin" });
  assert.deepEqual([r.status, r.json.code], [503, "HISTORICAL_DATA_EMPTY"]);
});

test("an ML service still running the old code (no /similar route) → 503 ML_SERVICE_OUTDATED with a restart hint", async () => {
  mlMode = "oldService";
  const { status, json } = await similar(oid(1), { as: "admin" });
  assert.deepEqual([status, json.code], [503, "ML_SERVICE_OUTDATED"]);
  assert.match(json.message, /Restart/);
});

test("ML crash or unrecognised error → 502 ML_SERVICE_ERROR, without leaking the ML service's internal text", async () => {
  for (const mode of ["crash", "weird503"]) {
    mlMode = mode;
    const { status, json } = await similar(oid(1), { as: "admin" });
    assert.deepEqual([status, json.code], [502, "ML_SERVICE_ERROR"], mode);
    assert.doesNotMatch(JSON.stringify(json), /secret|\/srv/, mode);
  }
});

test("ML service not running → 503 ML_SERVICE_UNAVAILABLE", async () => {
  const saved = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = "http://127.0.0.1:1"; // nothing listens here
  try {
    const { status, json } = await similar(oid(1), { as: "admin" });
    assert.equal(status, 503);
    assert.equal(json.code, "ML_SERVICE_UNAVAILABLE");
  } finally {
    process.env.ML_SERVICE_URL = saved;
  }
});

// ── Independence from the Random Forest feature and from rescue dispatch ────
test("the Random Forest severity endpoint is unaffected: still /predict, still returns its own prediction", async () => {
  await similar(oid(1), { as: "admin" });
  mlCalls = [];
  const { status, json } = await severity(oid(1), { as: "admin" });
  assert.equal(status, 200);
  assert.equal(json.advisory, true);
  assert.equal(json.prediction.predictedClass, "moderate");
  assert.equal(json.similarity, undefined);
  assert.deepEqual(mlCalls.map((c) => c.url), ["/predict"]);

  const manual = await severity(oid(1), { as: "admin", body: { scenario: { magnitude: 6.5, depth: 10, latitude: 30.7, longitude: 76.8 } } });
  assert.equal(manual.status, 200);
  assert.equal(manual.json.source, "manual");
});

test("the endpoint never writes to or queries Emergency beyond findById (informational only)", () => {
  assert.deepEqual(unexpectedEmergencyCalls, []);
});

test("static guard: the similarity code has no path to dispatch, status changes, sockets or the team recommender", () => {
  for (const file of ["controllers/similarityController.js", "services/similarityService.js"]) {
    const raw = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // ignore comments
    // `this.status = ...` is the error class's own HTTP status, not an emergency status change.
    assert.doesNotMatch(src, /teamRecommendationService|routingService|config\/socket|getIO|\.emit\(|\.save\(|assignedTo|(?<!this)\.status\s*=[^=]/, file);
    assert.doesNotMatch(src, /\.(create|updateOne|updateMany|findByIdAndUpdate|deleteOne|insertMany)\(/, file);
  }
});

test("existing admin routes are still mounted and still protected", async () => {
  for (const [method, url] of [
    ["GET", "/emergencies"],
    ["GET", "/stats"],
    ["GET", "/rescue-teams"],
    ["GET", `/emergencies/${oid(1)}/recommendations`],
    ["PATCH", `/emergencies/${oid(1)}/assign`],
    ["PATCH", `/emergencies/${oid(1)}/status`],
    ["POST", `/emergencies/${oid(1)}/severity`],
  ]) {
    const res = await fetch(base + url, { method });
    assert.equal(res.status, 401, `${method} ${url}`);
  }
});
