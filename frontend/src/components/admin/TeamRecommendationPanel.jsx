import { useEffect, useState, useCallback } from "react";
import { Zap, RefreshCw, MapPin, AlertTriangle } from "lucide-react";
import Spinner from "../common/Spinner";
import { adminApi } from "../../api/dataApi";

const fmtEta = (min) => `~${Math.max(1, Math.round(min))} min`;
const fmtKm = (km) => `${km.toFixed(1)} km`;

/**
 * "Fastest available rescue team" for ONE pending SOS.
 *
 * Ranking is by real road ETA from each team's BASE to the victim, computed
 * by the backend (OSRM). This panel only recommends — assignment always goes
 * through `onAssign` (the existing assignTeam flow) and is always the admin's
 * click; the recommended team is never auto-assigned.
 */
export default function TeamRecommendationPanel({ emergencyId, onAssign, assigning }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await adminApi.getTeamRecommendations(emergencyId);
      setData(data);
    } catch (err) {
      setData(null);
      setError(err.response?.data?.message || "Couldn't load recommendations");
    } finally {
      setLoading(false);
    }
  }, [emergencyId]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/40 py-2">
        <Spinner size="sm" /> Calculating road ETAs from team bases...
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm text-warning-400">
        <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span>
        <button onClick={load} className="btn-ghost text-xs">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const { recommendedTeam, teams, message } = data;
  const others = teams.filter((t) => t.availability === "available" && t.teamId !== recommendedTeam?.teamId);
  const busy = teams.filter((t) => t.availability === "busy");
  const unavailable = teams.filter((t) => t.availability === "unavailable");
  const anyRouteFailed = teams.some((t) => t.availability === "available" && t.baseLocation && !t.routeAvailable);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-white/40">
          Ranked by estimated road travel time from each team's base to the victim.
        </p>
        <button onClick={load} disabled={loading} className="btn-ghost text-xs flex items-center gap-1">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Recalculate
        </button>
      </div>

      {/* Fastest available team */}
      {recommendedTeam ? (
        <div className="glass border border-safe-500/30 p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-safe-400 font-semibold flex items-center gap-1 mb-1">
              <Zap className="h-3 w-3" /> Fastest Available Team
            </p>
            <p className="font-bold text-lg">🚑 {recommendedTeam.name}</p>
            <p className="text-xs text-white/50 flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {recommendedTeam.baseLocation?.name || "Base"} (demo base)
            </p>
            <p className="text-sm mt-1">
              <span className="text-warning-400 font-semibold">{fmtEta(recommendedTeam.estimatedTimeMinutes)}</span>
              <span className="text-white/40"> · </span>
              <span className="text-electric-400 font-semibold">{fmtKm(recommendedTeam.distance)}</span>
            </p>
            <p className="text-xs text-white/40 mt-1">Why? Fastest estimated road arrival among available teams.</p>
          </div>
          <button
            onClick={() => onAssign(emergencyId, recommendedTeam.teamId)}
            disabled={assigning}
            className="btn-primary px-4 py-2 text-sm"
          >
            {assigning ? "Assigning..." : "Assign Recommended Team"}
          </button>
        </div>
      ) : (
        <div className="glass border border-warning-500/30 p-4 text-sm text-warning-400 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            {message || "No available rescue team with a valid route."}
            {anyRouteFailed && " Route unavailable right now — you can still assign a team manually below or from the table."}
          </span>
        </div>
      )}

      {/* Other available teams (manual override stays possible) */}
      {others.length > 0 && (
        <div>
          <p className="text-xs text-white/40 mb-2">Other available teams</p>
          <div className="space-y-1.5">
            {others.map((t) => (
              <div key={t.teamId} className="flex items-center justify-between gap-3 px-3 py-2 glass border border-white/10 rounded-xl text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-safe-400" />
                  {t.name}
                  {t.baseLocation?.name && <span className="text-xs text-white/30">· {t.baseLocation.name}</span>}
                </span>
                <span className="flex items-center gap-3">
                  {t.routeAvailable ? (
                    <span className="text-xs text-white/60">{fmtEta(t.estimatedTimeMinutes)} · {fmtKm(t.distance)}</span>
                  ) : (
                    <span className="text-xs text-warning-400">
                      {t.routeUnavailableReason === "no_base_location" ? "No base location" : "Route unavailable"}
                    </span>
                  )}
                  <button
                    onClick={() => onAssign(emergencyId, t.teamId)}
                    disabled={assigning}
                    className="btn-ghost text-xs text-electric-400"
                  >
                    Assign
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Busy / inactive teams: shown for context, never recommended */}
      {(busy.length > 0 || unavailable.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {busy.map((t) => (
            <span key={t.teamId} className="badge badge-red">🔴 {t.name} — Busy</span>
          ))}
          {unavailable.map((t) => (
            <span key={t.teamId} className="badge badge-gray">⚫ {t.name} — Unavailable</span>
          ))}
        </div>
      )}

      <p className="text-[11px] text-white/25">
        Team bases are demo/project locations, not real emergency-station sites.
      </p>
    </div>
  );
}
