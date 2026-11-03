import { Fragment, useEffect, useRef, useState, lazy, Suspense } from "react";
import { motion } from "framer-motion";
import {
  Shield, Users, AlertTriangle, CheckCircle, Clock,
  Navigation, MapPin, RefreshCw, UserCheck, Zap, Activity
} from "lucide-react";
import Navbar from "../components/common/Navbar";
import Spinner from "../components/common/Spinner";
import TeamRecommendationPanel from "../components/admin/TeamRecommendationPanel";
import SeverityPanel from "../components/admin/SeverityPanel";
import SimilarityPanel from "../components/admin/SimilarityPanel";
import { adminApi } from "../api/dataApi";
import { getSocket } from "../lib/socket";
import toast from "react-hot-toast";

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
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function AdminDashboard() {
  const [emergencies, setEmergencies] = useState([]);
  const [teams, setTeams] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  // SOS row whose "fastest team" recommendation panel is open (one at a time)
  const [recommendFor, setRecommendFor] = useState(null);
  // SOS row whose advisory ML severity panel is open (one at a time)
  const [severityFor, setSeverityFor] = useState(null);

  // Team list incl. server-derived availability (available / busy). Refreshed
  // after assignments and resolutions so green/red stays accurate.
  const loadTeams = async () => {
    try {
      const { data } = await adminApi.getRescueTeams();
      setTeams(data.teams || []);
    } catch { /* keep the previous list */ }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [emRes, teamRes, statsRes] = await Promise.all([
        adminApi.getAllEmergencies({ status: statusFilter || undefined, limit: 50 }),
        adminApi.getRescueTeams(),
        adminApi.getStats(),
      ]);
      setEmergencies(emRes.data.emergencies || []);
      setTeams(teamRes.data.teams || []);
      setStats(statsRes.data.stats || null);
    } catch {
      toast.error("Failed to load admin data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const socket = getSocket();
    socket.on("emergency:new", ({ emergency, message }) => {
      setEmergencies((prev) => [emergency, ...prev]);
      toast.success(message, { icon: "🚨", duration: 6000 });
    });
    socket.on("emergency:resolved", ({ emergencyId }) => {
      setEmergencies((prev) =>
        prev.map((e) => (e._id === emergencyId ? { ...e, status: "resolved" } : e))
      );
      loadTeams(); // the team that finished is available again
    });
    return () => {
      socket.off("emergency:new");
      socket.off("emergency:resolved");
    };
  }, []);

  useEffect(() => { load(); }, [statusFilter]);

  // True while an assignment request is in flight — a second click / dropdown
  // pick is ignored so the same assignment is never sent twice.
  const assignInFlight = useRef(false);

  const handleAssign = async (emergencyId, teamId) => {
    if (assignInFlight.current) return;
    const chosen = teams.find((t) => t._id === teamId);
    if (chosen?.availability === "busy" &&
        !window.confirm(`${chosen.name} is currently handling another emergency. Assign anyway?`)) {
      return;
    }
    assignInFlight.current = true;
    setAssigning(emergencyId);
    // Immediate, honest "in progress" feedback. It is NOT a success message:
    // it is replaced (same toast id) by the real result once the server answers.
    const toastId = toast.loading(`Assigning ${chosen?.name || "rescue team"}...`);
    try {
      const { data } = await adminApi.assignTeam(emergencyId, teamId);
      // Use the server's confirmed assignment (populated assignedTeam) for the UI.
      const assignedTeam = data?.emergency?.assignedTeam || chosen;
      toast.success(`${assignedTeam?.name || "Rescue team"} assigned`, { id: toastId });
      setRecommendFor(null);
      setEmergencies((prev) =>
        prev.map((e) => (e._id === emergencyId ? { ...e, status: "assigned", assignedTeam } : e))
      );
      loadTeams(); // refresh Available/Busy in the background — nothing waits on it
    } catch (err) {
      toast.error(err.response?.data?.message || "Assignment failed", { id: toastId });
    } finally {
      assignInFlight.current = false;
      setAssigning(null);
    }
  };

  const statItems = stats
    ? [
        { label: "Total",    value: stats.total,     icon: AlertTriangle, color: "blue"   },
        { label: "Pending",  value: stats.pending,   icon: Clock,         color: "yellow" },
        { label: "Active",   value: stats.assigned,  icon: Navigation,    color: "red"    },
        { label: "Resolved", value: stats.resolved,  icon: CheckCircle,   color: "green"  },
      ]
    : [];

  return (
    <div className="min-h-screen bg-grid">
      <Navbar />
      <div className="pt-28 pb-20 px-6 max-w-7xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-warning-500/20 rounded-xl">
                <Shield className="h-6 w-6 text-warning-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Admin Dashboard</h1>
                <p className="text-white/40 text-sm">Emergency management & rescue coordination</p>
              </div>
            </div>
            <button onClick={load} className="btn-ghost border border-white/20 rounded-xl px-4 py-2 flex items-center gap-2 text-sm">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {statItems.map(({ label, value, icon: Icon, color }, i) => {
            const colorMap = { blue: "text-electric-400 bg-electric-500/10", yellow: "text-warning-400 bg-warning-500/10", red: "text-danger-400 bg-danger-500/10", green: "text-safe-400 bg-safe-500/10" };
            const c = colorMap[color];
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="glass border border-white/10 p-5 text-center"
              >
                <div className={`inline-flex p-2.5 rounded-xl ${c.split(" ")[1]} mb-3`}>
                  <Icon className={`h-5 w-5 ${c.split(" ")[0]}`} />
                </div>
                <p className={`text-3xl font-black ${c.split(" ")[0]}`}>{value ?? "—"}</p>
                <p className="text-xs text-white/40 mt-1">{label}</p>
              </motion.div>
            );
          })}
        </div>

        {/* Rescue Teams */}
        <div className="glass border border-white/10 mb-6 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-electric-400" /> Rescue Teams ({teams.length})
            </h2>
          </div>
          <div className="flex flex-wrap gap-3 p-6">
            {teams.map((t) => {
              const busy = t.availability === "busy";
              return (
                <div key={t._id} className="flex items-center gap-2 px-4 py-2 glass border border-white/10 rounded-full">
                  <div className={`w-2 h-2 rounded-full ${busy ? "bg-danger-400" : "bg-safe-400 animate-pulse"}`} />
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className={`text-xs ${busy ? "text-danger-400" : "text-safe-400"}`}>
                    {busy ? "Busy" : "Available"}
                  </span>
                  {t.baseLocation?.name && <span className="text-xs text-white/30">· {t.baseLocation.name}</span>}
                  {t.phone && <span className="text-xs text-white/40">{t.phone}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Emergencies table */}
        <div className="glass border border-white/10 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-3">
            <h2 className="font-semibold">All Emergencies</h2>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="input py-1.5 text-sm w-auto"
              >
                <option value="">All Statuses</option>
                {Object.keys(STATUS_CONFIG).map((s) => (
                  <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <Spinner className="py-16" />
          ) : emergencies.length === 0 ? (
            <div className="text-center py-16 text-white/30">
              <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No emergencies found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {["User", "Type", "Location", "Status", "Time", "Assign Team"].map((h) => (
                      <th key={h} className="text-left px-6 py-3 text-xs text-white/40 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {emergencies.map((e, i) => {
                    const sc = STATUS_CONFIG[e.status] || STATUS_CONFIG.pending;
                    const StatusIcon = sc.icon;
                    return (
                      <Fragment key={e._id}>
                      <motion.tr
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.03 }}
                        className="hover:bg-white/5 transition-colors"
                      >
                        <td className="px-6 py-4">
                          <p className="font-medium">{e.user?.name || "Unknown"}</p>
                          <p className="text-xs text-white/40">{e.user?.phone || e.user?.email}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`badge ${e.type === "safe" ? "badge-green" : "badge-red"}`}>
                            {e.type === "safe" ? "Safe Route" : "Rescue SOS"}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-white/40">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {e.location?.lat?.toFixed(3)}, {e.location?.lng?.toFixed(3)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`badge ${sc.cls}`}>
                            <StatusIcon className="h-3 w-3" />{sc.label}
                          </span>
                          {e.assignedTeam && (
                            <p className="text-xs text-electric-400 mt-1">{e.assignedTeam.name}</p>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs text-white/40">{timeAgo(e.createdAt)}</td>
                        <td className="px-6 py-4">
                          {e.type === "rescue" && e.status === "pending" ? (
                            <select
                              onChange={(ev) => ev.target.value && handleAssign(e._id, ev.target.value)}
                              disabled={assigning === e._id}
                              className="input py-1.5 text-xs w-full max-w-[160px]"
                              defaultValue=""
                            >
                              <option value="">
                                {assigning === e._id ? "Assigning..." : "Select team"}
                              </option>
                              {teams.map((t) => (
                                <option key={t._id} value={t._id}>
                                  {t.name}{t.availability === "busy" ? " (busy)" : ""}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-white/20">—</span>
                          )}
                          {e.type === "rescue" && e.status === "pending" && (
                            <button
                              onClick={() => setRecommendFor((id) => (id === e._id ? null : e._id))}
                              className="btn-ghost text-xs text-safe-400 flex items-center gap-1 mt-2 px-0"
                            >
                              <Zap className="h-3 w-3" />
                              {recommendFor === e._id ? "Hide fastest team" : "Fastest team"}
                            </button>
                          )}
                          {e.type === "rescue" && (
                            <button
                              onClick={() => setSeverityFor((id) => (id === e._id ? null : e._id))}
                              className="btn-ghost text-xs text-electric-400 flex items-center gap-1 mt-2 px-0"
                            >
                              <Activity className="h-3 w-3" />
                              {severityFor === e._id ? "Hide severity" : "Analyze Severity"}
                            </button>
                          )}
                        </td>
                      </motion.tr>
                      {recommendFor === e._id && e.status === "pending" && (
                        <tr className="bg-white/[0.02]">
                          <td colSpan={6} className="px-6 py-4">
                            <TeamRecommendationPanel
                              emergencyId={e._id}
                              onAssign={handleAssign}
                              assigning={assigning === e._id}
                            />
                          </td>
                        </tr>
                      )}
                      {severityFor === e._id && (
                        <tr className="bg-white/[0.02]">
                          <td colSpan={6} className="px-6 py-4">
                            <SeverityPanel emergencyId={e._id} location={e.location} />
                            {/* Separate informational KNN analysis; independent of the severity panel above. */}
                            <div className="border-t border-white/10 mt-5 pt-5">
                              <SimilarityPanel emergencyId={e._id} location={e.location} />
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
