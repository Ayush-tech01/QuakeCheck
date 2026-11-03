import { useEffect, useState, lazy, Suspense } from "react";
import { motion } from "framer-motion";
import { Navigation, CheckCircle, AlertTriangle, Clock, MapPin, Radio, Phone, Locate, LocateOff, AlertOctagon } from "lucide-react";
import Navbar from "../components/common/Navbar";
import Spinner from "../components/common/Spinner";
import { rescueApi } from "../api/dataApi";
import { getSocket } from "../lib/socket";
import { useAuth } from "../context/AuthContext";
import { useGeolocation } from "../hooks/useGeolocation";
import toast from "react-hot-toast";
import { subscribeSimulatedLocation } from "../dev/devLocation";

const RouteMap = lazy(() => import("../components/map/RouteMap"));

// How often to report the rescue team's location while sharing is on, and
// keep active-mission routes recalculated server-side. 20s balances staying
// current against not hammering the routing service (the backend also
// applies its own movement-distance threshold on top of this).
const LOCATION_SHARE_INTERVAL_MS = 20000;

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function RescueDashboard() {
  const { user } = useAuth();
  const { getLocation } = useGeolocation();
  const [assigned, setAssigned] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [myLocation, setMyLocation] = useState(user?.location || null);
  const [lastShared, setLastShared] = useState(null);
  const [sharingBusy, setSharingBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await rescueApi.getAssigned();
      setAssigned(data.emergencies || []);
    } catch {
      toast.error("Failed to load assignments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const socket = getSocket();
    socket.on("emergency:assigned", ({ emergency }) => {
      setAssigned((prev) => {
        if (prev.find((e) => e._id === emergency._id)) return prev;
        return [emergency, ...prev];
      });
      toast.success("New rescue mission assigned!", { icon: "🚑", duration: 6000 });
    });

    // Live route recalculation: the backend recomputes a mission's route
    // whenever this team's location moves meaningfully, and pushes the
    // result here so the map updates without a manual refresh.
    socket.on("emergency:routeUpdated", ({ emergencyId, route, distance, estimatedTime, routeStatus }) => {
      const patch = { route, routeDistance: distance, estimatedTime, routeStatus };
      setAssigned((prev) => prev.map((e) => (e._id === emergencyId ? { ...e, ...patch } : e)));
      setSelected((s) => (s && s._id === emergencyId ? { ...s, ...patch } : s));
    });

    return () => {
      socket.off("emergency:assigned");
      socket.off("emergency:routeUpdated");
    };
  }, []);

  // Report location once, immediately, when sharing turns on — then again
  // every LOCATION_SHARE_INTERVAL_MS while it stays on.
  const shareLocationOnce = async () => {
    setSharingBusy(true);
    try {
      const loc = await getLocation();
      await rescueApi.updateLocation({ lat: loc.lat, lng: loc.lng });
      setMyLocation(loc);
      setLastShared(new Date());
      return true;
    } catch (err) {
      // getLocation() rejects with a plain string message, not an Error.
      toast.error(typeof err === "string" ? err : "Couldn't get your location");
      return false;
    } finally {
      setSharingBusy(false);
    }
  };

  const toggleSharing = async () => {
    if (sharingLocation) {
      setSharingLocation(false);
      toast("Location sharing stopped", { icon: "📍" });
      return;
    }
    const ok = await shareLocationOnce();
    if (ok) {
      setSharingLocation(true);
      toast.success("Sharing your location — active mission routes will stay updated");
    }
  };

  // Periodic re-share while sharing is on. LOCATION_SHARE_INTERVAL_MS was
  // documented above but nothing used it, so a team on real GPS only ever
  // reported once — which would leave the victim's live view frozen. Failures
  // are silent here (no toast every 20s); the next tick simply tries again.
  useEffect(() => {
    if (!sharingLocation) return undefined;
    const id = setInterval(async () => {
      try {
        const loc = await getLocation();
        await rescueApi.updateLocation({ lat: loc.lat, lng: loc.lng });
        setMyLocation(loc);
        setLastShared(new Date());
      } catch {
        /* transient GPS/network failure — retry on next tick */
      }
    }, LOCATION_SHARE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sharingLocation, getLocation]);

    // In development, immediately push a new simulated rescue-team
  // location whenever the Dev Location Simulator changes.
  useEffect(() => {
    if (!import.meta.env.DEV || !sharingLocation) return;

    return subscribeSimulatedLocation(async (loc) => {
      if (!loc) return;

      try {
        setSharingBusy(true);
        await rescueApi.updateLocation({
          lat: loc.lat,
          lng: loc.lng,
        });
        setMyLocation(loc);
        setLastShared(new Date());
      } catch {
        toast.error("Failed to update simulated rescue location");
      } finally {
        setSharingBusy(false);
      }
    });
  }, [sharingLocation]);

  const handleEnRoute = async (id) => {
    setActionLoading(id);
    try {
      await rescueApi.markEnRoute(id);
      setAssigned((prev) => prev.map((e) => (e._id === id ? { ...e, status: "en_route" } : e)));
      if (selected?._id === id) setSelected((s) => ({ ...s, status: "en_route" }));
      toast.success("Marked as en route!");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleComplete = async (id) => {
    setActionLoading(id);
    try {
      await rescueApi.complete(id);
      setAssigned((prev) => prev.filter((e) => e._id !== id));
      if (selected?._id === id) setSelected(null);
      toast.success("Rescue mission completed!");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-grid">
      <Navbar />
      <div className="pt-28 pb-20 px-6 max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-danger-500/20 rounded-xl">
                <Navigation className="h-6 w-6 text-danger-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Rescue Team Dashboard</h1>
                <p className="text-white/40 text-sm">{user?.name} — Active missions</p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <button
                onClick={toggleSharing}
                disabled={sharingBusy}
                className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl border transition-all duration-200 ${
                  sharingLocation
                    ? "bg-safe-500/15 border-safe-500/30 text-safe-400"
                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                }`}
              >
                {sharingBusy ? (
                  <Spinner size="sm" />
                ) : sharingLocation ? (
                  <Locate className="h-4 w-4" />
                ) : (
                  <LocateOff className="h-4 w-4" />
                )}
                {sharingLocation ? "Sharing Location" : "Share My Location"}
              </button>
              {sharingLocation && lastShared && (
                <p className="text-[11px] text-white/30">Last shared {timeAgo(lastShared)}</p>
              )}
              {!sharingLocation && (
                <p className="text-[11px] text-white/30 max-w-[220px] text-right">
                  Turn on so victims get an accurate route to you
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {loading ? (
          <Spinner className="py-20" size="lg" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Mission List */}
            <div className="lg:col-span-2 space-y-4">
              {assigned.length === 0 ? (
                <div className="glass border border-white/10 p-10 text-center">
                  <CheckCircle className="h-12 w-12 text-safe-400 mx-auto mb-3 opacity-50" />
                  <p className="text-white/40">No active missions</p>
                  <p className="text-xs text-white/20 mt-1">You'll be notified when assigned</p>
                </div>
              ) : (
                assigned.map((e, i) => (
                  <motion.div
                    key={e._id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    onClick={() => setSelected(e)}
                    className={`glass border-2 p-5 cursor-pointer transition-all duration-200 hover:bg-white/5 ${
                      selected?._id === e._id ? "border-danger-500/50 bg-danger-500/5" : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 bg-danger-500/15 rounded-xl mt-0.5">
                        <AlertTriangle className="h-5 w-5 text-danger-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-semibold text-sm">{e.user?.name || "Victim"}</p>
                          <span className={`badge ${e.status === "en_route" ? "badge-blue" : "badge-yellow"} text-xs`}>
                            {e.status === "en_route" ? "En Route" : "Assigned"}
                          </span>
                        </div>
                        {e.user?.phone && (
                          <p className="flex items-center gap-1 text-xs text-electric-400 mb-1">
                            <Phone className="h-3 w-3" />{e.user.phone}
                          </p>
                        )}
                        <p className="flex items-center gap-1 text-xs text-white/40">
                          <MapPin className="h-3 w-3" />
                          {e.location.lat.toFixed(4)}, {e.location.lng.toFixed(4)}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-white/30 mt-1">
                          <Clock className="h-3 w-3" />{timeAgo(e.createdAt)}
                        </p>
                        {e.notes && <p className="text-xs text-warning-400 mt-2 italic">"{e.notes}"</p>}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 mt-4">
                      {e.status === "assigned" && (
                        <button
                          onClick={(ev) => { ev.stopPropagation(); handleEnRoute(e._id); }}
                          disabled={actionLoading === e._id}
                          className="btn-primary text-xs py-2 px-4 flex-1 flex items-center justify-center gap-1"
                        >
                          {actionLoading === e._id ? <Spinner size="sm" /> : <><Navigation className="h-3 w-3" /> En Route</>}
                        </button>
                      )}
                      {e.status === "en_route" && (
                        <button
                          onClick={(ev) => { ev.stopPropagation(); handleComplete(e._id); }}
                          disabled={actionLoading === e._id}
                          className="btn-safe text-xs py-2 px-4 flex-1 flex items-center justify-center gap-1"
                        >
                          {actionLoading === e._id ? <Spinner size="sm" /> : <><CheckCircle className="h-3 w-3" /> Rescued</>}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>

            {/* Route Map */}
            <div className="lg:col-span-3 glass border border-white/10 overflow-hidden rounded-2xl h-[520px] flex flex-col">
              {selected ? (
                <>
                  <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Radio className="h-4 w-4 text-danger-400 animate-pulse" />
                      <span className="text-sm font-medium">Route to {selected.user?.name}</span>
                    </div>
                    {selected.routeStatus === "ok" && selected.routeDistance != null && (
                      <span className="text-xs text-white/40">
                        {selected.routeDistance.toFixed(2)} km · ~{Math.round(selected.estimatedTime)} min
                      </span>
                    )}
                  </div>

                  {!myLocation ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                      <LocateOff className="h-14 w-14 text-white/10 mb-4" />
                      <p className="text-white/40 font-medium mb-1">Your location isn't shared yet</p>
                      <p className="text-white/25 text-sm max-w-xs">
                        Turn on "Share My Location" above so we can route you to {selected.user?.name}.
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 relative">
                      {/* The map (with both markers) always shows once we know our own
                          location — a route line only draws on top of it when one is
                          actually available. When it isn't, a banner overlays the map
                          rather than replacing it, so you still see roughly where you
                          are relative to the victim instead of a blank state. */}
                      <Suspense fallback={<div className="h-full flex items-center justify-center"><Spinner size="lg" /></div>}>
                        <RouteMap
                          userLocation={myLocation}
                          targetLocation={{ lat: selected.location.lat, lng: selected.location.lng }}
                          route={selected.routeStatus === "ok" ? selected.route : []}
                          targetLabel={selected.user?.name}
                          mode="rescue"
                        />
                      </Suspense>

                      {(selected.routeStatus !== "ok" || !selected.route?.length) && (
                        <div className="absolute top-3 left-3 right-3 z-[500] glass border border-warning-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
                          <AlertOctagon className="h-5 w-5 text-warning-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-warning-400 font-medium text-sm">Route unavailable</p>
                            <p className="text-white/40 text-xs mt-0.5">
                              We couldn't compute a road route right now. Markers above show where you and{" "}
                              {selected.user?.name} are — this updates automatically as your location keeps
                              sharing, and no fallback line is shown so this never looks like a real route.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <Navigation className="h-16 w-16 text-white/10 mb-4" />
                  <p className="text-white/30">Select a mission to view the route</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
