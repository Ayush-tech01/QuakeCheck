import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, RefreshCw, AlertTriangle, Info, FlaskConical } from "lucide-react";
import Spinner from "../common/Spinner";
import { adminApi } from "../../api/dataApi";

// Full class names (not built dynamically) so Tailwind keeps them.
const TONE = {
  low:      { badge: "badge-green",  bar: "bg-safe-400" },
  moderate: { badge: "badge-yellow", bar: "bg-warning-400" },
  high:     { badge: "badge-red",    bar: "bg-danger-400" },
  green:    { badge: "badge-green",  bar: "bg-safe-400" },
  yellow:   { badge: "badge-yellow", bar: "bg-warning-400" },
  orange:   { badge: "badge-yellow", bar: "bg-warning-400" },
  red:      { badge: "badge-red",    bar: "bg-danger-400" },
};
const tone = (cls) => TONE[cls] || { badge: "badge-gray", bar: "bg-white/40" };

const pct = (p) => `${Math.round(p * 100)}%`;

// "3 h 12 min" / "45 min" — how long before the SOS was raised the earthquake occurred.
const formatBefore = (minutes) => {
  if (minutes < 1) return "less than a minute";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
};

const SCENARIO_FIELDS = [
  { key: "magnitude", label: "Magnitude", step: "0.1" },
  { key: "depth", label: "Depth (km)", step: "1" },
  { key: "latitude", label: "Latitude", step: "any" },
  { key: "longitude", label: "Longitude", step: "any" },
];

/**
 * Advisory ML severity analysis for ONE rescue SOS (admin only).
 *
 * Calls POST /api/admin/emergencies/:id/severity, which is read-only: this panel never
 * assigns a team, changes a status, or reorders anything. It only displays the estimate.
 */
export default function SeverityPanel({ emergencyId, location }) {
  // status: "loading" | "success" | "empty" | "error"
  const [status, setStatus] = useState("loading");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    magnitude: "",
    depth: "10",
    latitude: location?.lat != null ? String(location.lat) : "",
    longitude: location?.lng != null ? String(location.lng) : "",
  });
  const [formError, setFormError] = useState(null);

  // Ignore responses from a superseded request (re-run, or the panel was closed).
  const latestRequest = useRef(0);

  const run = useCallback(
    async (scenario) => {
      const requestId = ++latestRequest.current;
      setStatus("loading");
      setError(null);
      try {
        const { data: res } = await adminApi.analyzeSeverity(emergencyId, scenario);
        if (requestId !== latestRequest.current) return;
        setData(res);
        setStatus(res.prediction ? "success" : "empty");
      } catch (err) {
        if (requestId !== latestRequest.current) return;
        setData(null);
        setError(err.response?.data?.message || "Couldn't analyse severity. Please try again.");
        setStatus("error");
      }
    },
    [emergencyId]
  );

  useEffect(() => {
    run();
    return () => {
      latestRequest.current += 1;
    };
  }, [run]);

  const submitScenario = () => {
    const scenario = {};
    for (const { key, label } of SCENARIO_FIELDS) {
      const value = form[key] === "" ? NaN : Number(form[key]);
      if (!Number.isFinite(value)) {
        setFormError(`${label} must be a number`);
        return;
      }
      scenario[key] = value;
    }
    setFormError(null);
    run(scenario);
  };

  const prediction = data?.prediction;
  const quake = data?.quake;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-electric-400" />
          <p className="text-sm font-semibold">Seismic impact severity</p>
          <span className="badge badge-blue">ML · advisory</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn-ghost text-xs flex items-center gap-1"
          >
            <FlaskConical className="h-3 w-3" />
            {showForm ? "Hide manual scenario" : "Manual scenario"}
          </button>
          <button
            onClick={() => run()}
            disabled={status === "loading"}
            className="btn-ghost text-xs flex items-center gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${status === "loading" ? "animate-spin" : ""}`} /> Re-run
          </button>
        </div>
      </div>

      <p className="text-[11px] text-white/40 flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
        Advisory only. This does not assign teams, change the emergency's status, or set rescue priority — those stay manual decisions.
      </p>

      {showForm && (
        <div className="glass border border-white/10 p-4 space-y-3">
          <p className="text-xs text-white/50">
            What-if run: enter an earthquake's parameters (defaults to this SOS's coordinates as the epicentre).
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {SCENARIO_FIELDS.map(({ key, label, step }) => (
              <label key={key} className="text-xs text-white/50 space-y-1">
                <span>{label}</span>
                <input
                  type="number"
                  step={step}
                  value={form[key]}
                  onChange={(ev) => setForm((f) => ({ ...f, [key]: ev.target.value }))}
                  className="input py-1.5 text-xs w-full"
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={submitScenario} disabled={status === "loading"} className="btn-primary px-4 py-1.5 text-xs">
              Run scenario
            </button>
            {formError && <span className="text-xs text-warning-400">{formError}</span>}
          </div>
        </div>
      )}

      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-white/40 py-2">
          <Spinner size="sm" /> Analysing severity...
        </div>
      )}

      {status === "error" && (
        <div className="flex items-center justify-between gap-3 text-sm text-warning-400">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </span>
          <button onClick={() => run()} className="btn-ghost text-xs">Retry</button>
        </div>
      )}

      {status === "empty" && (
        <div className="glass border border-white/10 p-4 text-sm text-white/60 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-electric-400" />
          <span>{data?.message || "Nothing to analyse for this SOS."}</span>
        </div>
      )}

      {status === "success" && prediction && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Result */}
          <div className="glass border border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`badge ${tone(prediction.predictedClass).badge} text-sm px-3 py-1`}>
                {prediction.label} expected impact
              </span>
              <span className="text-xs text-white/50">model confidence {pct(prediction.confidence)}</span>
            </div>
            <div className="space-y-1.5">
              {/* Model class order (low → high); JSON object key order is not guaranteed. */}
              {prediction.model.classes.map((cls) => [cls, prediction.probabilities[cls] ?? 0]).map(([cls, p]) => (
                <div key={cls} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-white/60 capitalize">{cls}</span>
                  <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className={`h-full ${tone(cls).bar}`} style={{ width: pct(p) }} />
                  </div>
                  <span className="w-10 text-right text-white/50">{pct(p)}</span>
                </div>
              ))}
            </div>
            <ul className="text-xs text-white/60 space-y-1.5 list-disc pl-4">
              {prediction.explanation.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          {/* Input information */}
          <div className="glass border border-white/10 p-4 space-y-3 text-xs">
            <p className="font-semibold text-sm">Input used</p>
            {data.source === "manual" ? (
              <p className="text-white/50">Manual what-if scenario entered by an admin (not a real feed event).</p>
            ) : (
              quake && (
                <div className="text-white/60 space-y-1.5">
                  <div className="space-y-0.5">
                    <p className="text-white/40 uppercase tracking-wide text-[10px]">Matched earthquake</p>
                    <p className="text-white/80">M{quake.magnitude} · {quake.place}</p>
                    <p>
                      <span className="text-white/80">{quake.distanceKm} km</span> from this SOS ·{" "}
                      <span className="text-white/80">{formatBefore(quake.minutesBeforeSos)}</span> before the SOS was raised
                    </p>
                    <p>{new Date(quake.time).toLocaleString()} · source: {quake.source}</p>
                    <p>
                      Official USGS PAGER alert:{" "}
                      {quake.officialAlert ? (
                        <span className="font-semibold capitalize">{quake.officialAlert}</span>
                      ) : (
                        "none published"
                      )}
                      {quake.officialAlert && " — prefer this over the ML estimate"}
                    </p>
                  </div>
                  <p className="text-warning-400/80">
                    Matched only by location and time. This does not establish that this earthquake caused or relates to this SOS.
                  </p>
                  {data.matching && (
                    <p className="text-white/40">
                      Rule: magnitude ≥ {data.matching.minMagnitude}, within {data.matching.radiusKm} km of this SOS, in the{" "}
                      {data.matching.windowHours} h before it was raised. {data.matching.candidatesConsidered} qualified; the strongest was used.
                    </p>
                  )}
                  {data.otherCandidates?.length > 0 && (
                    <div className="text-white/40">
                      <p>Also qualified (not analysed):</p>
                      <ul className="space-y-0.5 list-disc pl-4">
                        {data.otherCandidates.map((c) => (
                          <li key={c.eventId}>
                            M{c.magnitude} · {c.distanceKm} km · {formatBefore(c.minutesBeforeSos)} before · {c.place}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            )}
            <table className="w-full text-white/60">
              <tbody>
                <tr><td className="py-0.5">Magnitude</td><td className="text-right text-white/80">{prediction.inputs.magnitude}</td></tr>
                <tr><td className="py-0.5">Depth</td><td className="text-right text-white/80">{prediction.inputs.depth} km</td></tr>
                <tr><td className="py-0.5">Epicentre</td><td className="text-right text-white/80">{prediction.inputs.latitude.toFixed(3)}, {prediction.inputs.longitude.toFixed(3)}</td></tr>
              </tbody>
            </table>
            <div className="border-t border-white/10 pt-2 text-white/40 space-y-0.5">
              <p>
                {prediction.model.type} · trained {prediction.model.trainedAtUtc?.slice(0, 10)} · {prediction.model.nTrain} training events
              </p>
              <p>
                Held-out test macro-F1 {prediction.model.testMacroF1} · balanced accuracy {prediction.model.testBalancedAccuracy}
              </p>
            </div>
          </div>

          {prediction.warnings?.length > 0 && (
            <div className="md:col-span-2 glass border border-warning-500/30 p-3 text-xs text-warning-400 space-y-1">
              {prediction.warnings.map((w) => (
                <p key={w} className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
