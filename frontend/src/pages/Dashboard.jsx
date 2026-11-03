import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { History, CheckCircle, AlertTriangle, Clock, MapPin, Navigation, Shield, Radio } from "lucide-react";
import Navbar from "../components/common/Navbar";
import Spinner from "../components/common/Spinner";
import { emergencyApi } from "../api/emergencyApi";
import { useAuth } from "../context/AuthContext";
import { getSocket } from "../lib/socket";
import toast from "react-hot-toast";
import LiveRescueTracker from "../components/tracking/LiveRescueTracker";

const STATUS_CONFIG = {
  pending:   { label: "Pending",   cls: "badge-yellow", icon: Clock },
  assigned:  { label: "Assigned",  cls: "badge-blue",   icon: Shield },
  en_route:  { label: "En Route",  cls: "badge-blue",   icon: Navigation },
  resolved:  { label: "Resolved",  cls: "badge-green",  icon: CheckCircle },
  cancelled: { label: "Cancelled", cls: "badge-gray",   icon: AlertTriangle },
};

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [emergencies, setEmergencies] = useState([]);
  const [loading, setLoading] = useState(true);
  // History row whose live rescue tracking is expanded (one at a time).
  const [trackingId, setTrackingId] = useState(null);

  const load = async () => {
    try {
      const { data } = await emergencyApi.getMyEmergencies();
      setEmergencies(data.emergencies || []);
    } catch {
      toast.error("Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const socket = getSocket();
    const onStatus = ({ emergencyId, status }) => {
      setEmergencies((prev) =>
        prev.map((e) => (e._id === emergencyId ? { ...e, status } : e))
      );
      toast.success(`Emergency status updated: ${STATUS_CONFIG[status]?.label}`);
    };
    socket.on("emergency:status", onStatus);
    // Remove only this handler — a bare off("emergency:status") would also
    // strip the live-tracking hook's listener for the same event.
    return () => { socket.off("emergency:status", onStatus); };
  }, []);

  const stats = {
    total:    emergencies.length,
    active:   emergencies.filter((e) => ["pending", "assigned", "en_route"].includes(e.status)).length,
    resolved: emergencies.filter((e) => e.status === "resolved").length,
  };

  return (
    <div className="min-h-screen bg-grid">
      <Navbar />
      <div className="pt-28 pb-20 px-6 max-w-4xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-electric-500/20 rounded-xl">
              <History className="h-6 w-6 text-electric-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">My Dashboard</h1>
              <p className="text-white/40 text-sm">Welcome, {user?.name}</p>
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Total", value: stats.total, color: "text-electric-400" },
            { label: "Active", value: stats.active, color: "text-warning-400" },
            { label: "Resolved", value: stats.resolved, color: "text-safe-400" },
          ].map(({ label, value, color }, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="glass border border-white/10 p-5 text-center"
            >
              <p className={`text-3xl font-black ${color}`}>{value}</p>
              <p className="text-xs text-white/40 mt-1">{label}</p>
            </motion.div>
          ))}
        </div>

        {/* Emergency History */}
        <div className="glass border border-white/10 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="font-semibold text-white">Emergency History</h2>
            <button onClick={load} className="btn-ghost text-xs text-electric-400">Refresh</button>
          </div>

          {loading ? (
            <Spinner className="py-16" />
          ) : emergencies.length === 0 ? (
            <div className="text-center py-16 text-white/30">
              <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No emergency records yet</p>
              <p className="text-xs mt-1">Use the Emergency page to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {emergencies.map((e, i) => {
                const sc = STATUS_CONFIG[e.status] || STATUS_CONFIG.pending;
                const StatusIcon = sc.icon;
                return (
                  <motion.div
                    key={e._id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="px-6 py-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-xl mt-0.5 ${e.type === "safe" ? "bg-safe-500/15" : "bg-danger-500/15"}`}>
                          {e.type === "safe"
                            ? <CheckCircle className="h-4 w-4 text-safe-400" />
                            : <AlertTriangle className="h-4 w-4 text-danger-400" />
                          }
                        </div>
                        <div>
                          <p className="font-medium text-sm">
                            {e.type === "safe" ? "Safety Route Request" : "Rescue SOS"}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-white/40">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />{timeAgo(e.createdAt)}
                            </span>
                            {e.location && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {e.location.lat?.toFixed(4)}, {e.location.lng?.toFixed(4)}
                              </span>
                            )}
                            {e.routeDistance && (
                              <span className="flex items-center gap-1">
                                <Navigation className="h-3 w-3" />{e.routeDistance.toFixed(2)} km
                              </span>
                            )}
                          </div>
                          {e.assignedTeam && (
                            <p className="text-xs text-electric-400 mt-1">Team: {e.assignedTeam.name}</p>
                          )}
                          {e.shelter && (
                            <p className="text-xs text-safe-400 mt-1">Shelter: {e.shelter.name}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <span className={`badge ${sc.cls}`}>
                          <StatusIcon className="h-3 w-3" />
                          {sc.label}
                        </span>
                        {e.type === "rescue" && ["pending", "assigned", "en_route"].includes(e.status) && (
                          <button
                            onClick={() => setTrackingId((id) => (id === e._id ? null : e._id))}
                            className="btn-ghost text-xs text-electric-400 flex items-center gap-1"
                          >
                            <Radio className="h-3 w-3" />
                            {trackingId === e._id ? "Hide tracking" : "Track live"}
                          </button>
                        )}
                      </div>
                    </div>

                    {trackingId === e._id && (
                      <div className="mt-4">
                        <LiveRescueTracker emergencyId={e._id} />
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
