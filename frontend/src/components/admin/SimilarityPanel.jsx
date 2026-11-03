import { useCallback, useEffect, useRef, useState } from "react";
import { Search, AlertTriangle, Info, FlaskConical } from "lucide-react";
import Spinner from "../common/Spinner";
import { adminApi } from "../../api/dataApi";

// Historical PAGER alert colours (full class names so Tailwind keeps them).
const ALERT_BADGE = {
  green: "badge-green",
  yellow: "badge-yellow",
  orange: "badge-yellow",
  red: "badge-red",
};

const SCENARIO_FIELDS = [
  { key: "magnitude", label: "Magnitude", step: "0.1" },
  { key: "depth", label: "Depth (km)", step: "1" },
  { key: "latitude", label: "Latitude", step: "any" },
  { key: "longitude", label: "Longitude", step: "any" },
];

const signed = (n, digits) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const formatTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "");

/**
 * Historical earthquake similarity (KNN) for ONE rescue SOS — admin only.
 *
 * Deliberately separate from SeverityPanel (Random Forest): it never runs automatically, shows
 * historical USGS PAGER alerts of PAST earthquakes (not a prediction), and never changes the
 * severity result, assigns a team, or alters the emergency. It calls
 * POST /api/admin/emergencies/:id/similar-earthquakes, which is read-only.
 */
export default function SimilarityPanel({ emergencyId, location }) {
  // status: "idle" | "loading" | "success" | "empty" | "error"
  const [status, setStatus] = useState("idle");
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
  useEffect(
    () => () => {
      latestRequest.current += 1;
    },
    []
  );

  const run = useCallback(
    async (scenario) => {
      const requestId = ++latestRequest.current;
      setStatus("loading");
      setError(null);
      try {
        const { data: res } = await adminApi.findSimilarEarthquakes(emergencyId, scenario);
        if (requestId !== latestRequest.current) return;
        setData(res);
        setStatus(res.similarity ? "success" : "empty");
      } catch (err) {
        if (requestId !== latestRequest.current) return;
        setData(null);
        setError(err.response?.data?.message || "Couldn't compare with historical earthquakes. Please try again.");
        setStatus("error");
      }
    },
    [emergencyId]
  );

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

  const sim = data?.similarity;
  const quake = data?.quake;
  const loading = status === "loading";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-electric-400" />
          <p className="text-sm font-semibold">Historical earthquake similarity</p>
          <span className="badge badge-blue">ML · KNN · informational</span>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-ghost text-xs flex items-center gap-1">
          <FlaskConical className="h-3 w-3" />
          {showForm ? "Hide hypothetical scenario" : "Hypothetical scenario"}
        </button>
      </div>

      <p className="text-sm text-white/60">Compare this earthquake with historically similar events.</p>
      <p className="text-[11px] text-white/40 flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
        Separate from the severity estimate above and never combined with it. It lists past earthquakes only; it does not predict this
        earthquake's impact, and it does not assign teams, change status, or set rescue priority.
      </p>

      {showForm && (
        <div className="glass border border-white/10 p-4 space-y-3">
          <p className="text-xs text-warning-400/80">
            Hypothetical scenario, not a real earthquake. Results compare these made-up parameters with historical records.
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
            <button onClick={submitScenario} disabled={loading} className="btn-primary px-4 py-1.5 text-xs">
              Compare scenario
            </button>
            {formError && <span className="text-xs text-warning-400">{formError}</span>}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => run()} disabled={loading} className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" />
          {status === "idle" ? "Find Similar Historical Earthquakes" : "Run again for the matched earthquake"}
        </button>
        {loading && (
          <span className="flex items-center gap-2 text-sm text-white/40">
            <Spinner size="sm" /> Comparing with historical earthquakes...
          </span>
        )}
      </div>

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
          <span>{data?.message || "No earthquake is available to compare for this SOS."}</span>
        </div>
      )}

      {status === "success" && sim && (
        <div className="space-y-3">
          {/* What was compared */}
          <div className="glass border border-white/10 p-4 text-xs text-white/60 space-y-1">
            <p className="text-white/40 uppercase tracking-wide text-[10px]">
              {data.hypothetical ? "Hypothetical scenario (not a real earthquake)" : "Current earthquake compared"}
            </p>
            {quake && <p className="text-white/80">M{quake.magnitude} · {quake.place}</p>}
            <p>
              M{sim.inputs.magnitude} · depth {sim.inputs.depth} km · epicentre {sim.inputs.latitude.toFixed(3)}, {sim.inputs.longitude.toFixed(3)}
            </p>
            {quake && <p>Matched to this SOS only by location and time; the earthquake is the same one used by the severity analysis.</p>}
          </div>

          {sim.matches.length === 0 ? (
            <div className="glass border border-white/10 p-4 text-sm text-white/60 flex items-start gap-2">
              <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-electric-400" />
              <span>{sim.message || "No valid historical records were available to compare against."}</span>
            </div>
          ) : (
            <div className="glass border border-white/10 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-white/40 border-b border-white/10">
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Magnitude</th>
                    <th className="px-3 py-2 font-medium">Depth</th>
                    <th className="px-3 py-2 font-medium">Distance</th>
                    <th className="px-3 py-2 font-medium">Location</th>
                    <th className="px-3 py-2 font-medium">Historical PAGER alert</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.matches.map((m) => (
                    <tr key={m.eventId} className="border-b border-white/5 last:border-0 align-top text-white/70">
                      <td className="px-3 py-2 text-white/40">{m.rank}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-white/80">{formatDate(m.time)}</span>
                        {m.time && <span className="block text-white/40">{formatTime(m.time)}</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-white/80">M{m.magnitude}</span>
                        <span className="block text-white/40">{signed(m.magnitudeDifference, 1)} vs current</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-white/80">{m.depth} km</span>
                        <span className="block text-white/40">{signed(m.depthDifferenceKm, 0)} km</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-white/80">{Math.round(m.distanceKm).toLocaleString()} km</td>
                      <td className="px-3 py-2 min-w-[10rem]">{m.place || <span className="text-white/30">not recorded</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`badge ${ALERT_BADGE[m.historicalPagerAlert] || "badge-gray"}`}>{m.historicalPagerLabel}</span>
                        <span className="block text-white/30 mt-0.5">of that past event</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sim.message && sim.matches.length > 0 && (
            <p className="text-xs text-warning-400 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              {sim.message}
            </p>
          )}

          {sim.warnings?.length > 0 && (
            <div className="glass border border-warning-500/30 p-3 text-xs text-warning-400 space-y-1">
              {sim.warnings.map((w) => (
                <p key={w} className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}

          <div className="text-[11px] text-white/40 space-y-1">
            <p>
              Historical PAGER alerts are USGS's modelled estimates for those past earthquakes, not the Random Forest prediction for this one.
              Compared against {sim.reference.records.toLocaleString()} USGS records
              {sim.reference.startYear ? ` (${sim.reference.startYear}–${sim.reference.endYear})` : ""}; the five nearest by a combined
              distance over location (great-circle km), magnitude and depth (lower = more similar).
            </p>
            <p>{sim.reference.note}</p>
          </div>
        </div>
      )}
    </div>
  );
}
