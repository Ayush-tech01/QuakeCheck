import { useEffect, useState, lazy, Suspense } from "react";
import { Radio, Navigation, Clock, Phone, Loader2, CheckCircle, AlertOctagon, Shield } from "lucide-react";
import Spinner from "../common/Spinner";
import { useRescueTracking } from "../../hooks/useRescueTracking";

const RouteMap = lazy(() => import("../map/RouteMap"));

// Rescue teams report roughly every 20s while sharing is on (and immediately
// on any simulator/manual change). If nothing has arrived for this long we
// stop calling the feed "live" and show how old the last position is instead.
const STALE_AFTER_MS = 90 * 1000;

function formatAge(ms) {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs} second${secs === 1 ? "" : "s"} ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
}

/**
 * Victim-side live view of the rescue team assigned to one SOS.
 * Reused on the "SOS Sent" screen and when opening an SOS from history.
 */
export default function LiveRescueTracker({ emergencyId, mapHeight = "h-[340px]" }) {
  const { tracking, loading, error } = useRescueTracking(emergencyId);

  // Re-render every few seconds so "last updated X ago" / stale state stay
  // truthful even when no socket events are arriving.
  const [, setTick] = useState(0);
  const hasTeamLocation = !!tracking?.teamLocation;
  useEffect(() => {
    if (!hasTeamLocation) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [hasTeamLocation]);

  if (!tracking) {
    return (
      <div className="glass border border-white/10 p-4 flex items-center justify-center gap-2 text-sm text-white/40">
        {loading ? <><Spinner size="sm" /> Loading rescue status...</> : error || "Rescue status unavailable"}
      </div>
    );
  }

  const { status, team, teamLocation, route, distance, estimatedTime, routeStatus } = tracking;

  // ── Finished SOS: nothing live to show ─────────────────────
  if (status === "resolved") {
    return (
      <div className="glass border border-safe-500/30 p-4 text-center">
        <CheckCircle className="h-8 w-8 text-safe-400 mx-auto mb-2" />
        <p className="font-semibold text-safe-400">Rescue completed</p>
        <p className="text-xs text-white/40 mt-1">You have been rescued. Stay safe!</p>
      </div>
    );
  }
  if (status === "cancelled") {
    return (
      <div className="glass border border-white/10 p-4 text-center text-sm text-white/40">
        This SOS was cancelled.
      </div>
    );
  }

  // ── Waiting for an admin to assign a team ──────────────────
  if (status === "pending" || !team) {
    return (
      <div className="glass border border-warning-500/30 p-4 flex items-center gap-3 text-left">
        <Loader2 className="h-5 w-5 text-warning-400 animate-spin flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-warning-400">Waiting for rescue team assignment...</p>
          <p className="text-xs text-white/40 mt-0.5">Your SOS has been received and is being dispatched.</p>
        </div>
      </div>
    );
  }

  // ── Team assigned ──────────────────────────────────────────
  const enRoute = status === "en_route";
  const serverNow = Date.now() + (tracking.clockOffsetMs || 0);
  const ageMs = teamLocation?.updatedAt ? serverNow - new Date(teamLocation.updatedAt).getTime() : null;
  const stale = ageMs != null && ageMs > STALE_AFTER_MS;
  const routeOk = routeStatus === "ok" && route?.length > 1;

  const headline = enRoute ? "Rescue Team En Route" : "Rescue team assigned";
  const subline = enRoute
    ? "Rescue team is on the way to your location."
    : "A rescue team has been assigned and will set off shortly.";

  return (
    <div className="glass border border-danger-500/30 overflow-hidden text-left">
      <div className="px-4 py-3 border-b border-white/10 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {enRoute ? <Navigation className="h-4 w-4 text-danger-400 mt-1" /> : <Shield className="h-4 w-4 text-electric-400 mt-1" />}
          <div>
            <p className="font-semibold text-sm">🚨 {headline}</p>
            <p className="text-xs text-white/50">{subline}</p>
          </div>
        </div>
        <div className="text-right text-xs flex-shrink-0">
          <p className="text-white/70 font-medium">{team.name}</p>
          {team.phone && (
            <a href={`tel:${team.phone}`} className="inline-flex items-center gap-1 text-electric-400">
              <Phone className="h-3 w-3" />{team.phone}
            </a>
          )}
        </div>
      </div>

      {!teamLocation ? (
        <div className="p-6 flex flex-col items-center text-center gap-2">
          <Loader2 className="h-6 w-6 text-electric-400 animate-spin" />
          <p className="text-sm text-white/60">Waiting for rescue team location...</p>
          <p className="text-xs text-white/30 max-w-xs">
            The map appears as soon as the team shares its position. You don't need to refresh.
          </p>
        </div>
      ) : (
        <>
          <div className={`relative ${mapHeight}`}>
            <Suspense fallback={<div className="h-full flex items-center justify-center"><Spinner size="lg" /></div>}>
              <RouteMap
                mode="track"
                userLocation={tracking.victimLocation}
                rescueLocation={teamLocation}
                rescueLabel={team.name || "Rescue Team"}
                route={routeOk ? route : []}
              />
            </Suspense>

            {!routeOk && (
              <div className="absolute top-3 left-3 right-3 z-[500] glass border border-warning-500/30 rounded-xl px-3 py-2 flex items-start gap-2">
                <AlertOctagon className="h-4 w-4 text-warning-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-white/60">
                  Road route unavailable right now. Markers show where you and the rescue team are;
                  distance and arrival time will return automatically.
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 divide-x divide-white/10 border-t border-white/10">
            <div className="p-3 text-center">
              <p className="text-xs text-white/40 mb-0.5">Distance</p>
              <p className="font-bold text-electric-400">{routeOk && distance != null ? `${distance.toFixed(1)} km` : "—"}</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-xs text-white/40 mb-0.5">Estimated arrival</p>
              <p className="font-bold text-warning-400">{routeOk && estimatedTime != null ? `~${Math.max(1, Math.round(estimatedTime))} min` : "—"}</p>
            </div>
          </div>

          <div className="px-4 py-2 border-t border-white/10 text-xs flex items-center gap-2">
            {stale ? (
              <>
                <Clock className="h-3 w-3 text-warning-400" />
                <span className="text-warning-400">Last location received {formatAge(ageMs)}</span>
              </>
            ) : (
              <>
                <Radio className="h-3 w-3 text-safe-400 animate-pulse" />
                <span className="text-safe-400">Rescue team location updates live</span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
