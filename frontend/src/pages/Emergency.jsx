import { useState, useEffect, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, AlertTriangle, MapPin, Navigation, Clock, Home, ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "../components/common/Navbar";
import Spinner from "../components/common/Spinner";
import { useGeolocation } from "../hooks/useGeolocation";
import { emergencyApi } from "../api/emergencyApi";
import { useAuth } from "../context/AuthContext";
import { getSocket } from "../lib/socket";
import toast from "react-hot-toast";
import LiveRescueTracker from "../components/tracking/LiveRescueTracker";
import QuakeRiskNotice from "../components/cards/QuakeRiskNotice";
import { useQuakeRiskAlert } from "../hooks/useQuakeRiskAlert";

const RouteMap = lazy(() => import("../components/map/RouteMap"));

const STEP = { CHOOSE: "choose", LOCATING: "locating", ROUTING: "routing", RESULT: "result", SOS: "sos", SOS_SENT: "sos_sent", OUTSIDE_AREA: "outside_area" };

export default function Emergency() {
  const { user } = useAuth();
  const { location, error: geoError, loading: geoLoading, getLocation } = useGeolocation();
  const [step, setStep] = useState(STEP.CHOOSE);
  const [mode, setMode] = useState(null); // "safe" | "rescue"
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  // Context only: shown above the safety choice when a HIGH/CRITICAL quake is relevant.
  // It never changes the flow below and never creates an SOS by itself.
  const { elevated: elevatedQuakes } = useQuakeRiskAlert();

  // Toast when a team gets assigned to the SOS that was just sent. Registered
  // only while the "SOS Sent" screen is showing and removed when it goes away
  // (previously this listener was added on every submit and never removed).
  const sentEmergencyId = result?.emergency?._id;
  useEffect(() => {
    if (step !== STEP.SOS_SENT || !sentEmergencyId) return undefined;
    const socket = getSocket();
    const onStatus = (payload) => {
      if (payload.status === "assigned") {
        toast.success(`Rescue team assigned: ${payload.team?.name || "Team"}`, { duration: 8000 });
      }
    };
    socket.on("emergency:status", onStatus);
    return () => socket.off("emergency:status", onStatus);
  }, [step, sentEmergencyId]);

  const handleSafe = async () => {
    setMode("safe");
    setStep(STEP.LOCATING);
    setLoading(true);
    try {
      const coords = await getLocation();
      setStep(STEP.ROUTING);
      const { data } = await emergencyApi.markSafe({ lat: coords.lat, lng: coords.lng });
      setResult(data);
      setStep(STEP.RESULT);
      toast.success("Route to shelter found!");
    } catch (err) {
      if (err?.response?.data?.code === "OUTSIDE_OPERATIONAL_AREA") {
        setStep(STEP.OUTSIDE_AREA);
      } else {
        toast.error(typeof err === "string" ? err : err?.response?.data?.message || "Failed to get route");
        setStep(STEP.CHOOSE);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRescue = async () => {
    setMode("rescue");
    setStep(STEP.SOS);
  };

  const submitRescue = async () => {
    setLoading(true);
    try {
      const coords = await getLocation();
      const { data } = await emergencyApi.requestRescue({ lat: coords.lat, lng: coords.lng, notes });

      setResult(data);
      setStep(STEP.SOS_SENT);
      toast.success("SOS sent! Help is on the way.", { duration: 6000 });
    } catch (err) {
      if (err?.response?.data?.code === "OUTSIDE_OPERATIONAL_AREA") {
        setStep(STEP.OUTSIDE_AREA);
      } else {
        toast.error(typeof err === "string" ? err : err?.response?.data?.message || "Failed to send SOS");
      }
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep(STEP.CHOOSE);
    setMode(null);
    setResult(null);
    setNotes("");
  };

  return (
    <div className="min-h-screen bg-grid">
      <Navbar />
      <div className="pt-28 pb-20 px-6">
        <div className="max-w-5xl mx-auto">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-black mb-3">
              Emergency <span className="text-gradient-danger">Response</span>
            </h1>
            <p className="text-white/40">Tell us your situation and we'll help immediately</p>
          </motion.div>

          {/* ── CHOOSE STEP ─────────────────── */}
          {step === STEP.CHOOSE && (
            <>
            {elevatedQuakes.length > 0 && (
              <div className="max-w-3xl mx-auto mb-6">
                <QuakeRiskNotice items={elevatedQuakes} variant="safety" />
              </div>
            )}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto"
            >
              {/* I'm Safe */}
              <motion.button
                onClick={handleSafe}
                whileHover={{ scale: 1.02, y: -4 }}
                whileTap={{ scale: 0.98 }}
                className="glass border-2 border-safe-500/30 p-10 text-center hover:border-safe-400/50 
                           hover:bg-safe-500/5 transition-all duration-300 cursor-pointer group relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-safe-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="inline-flex p-5 bg-safe-500/15 rounded-full mb-6 group-hover:bg-safe-500/25 transition-colors">
                    <CheckCircle className="h-14 w-14 text-safe-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-safe-400 mb-3">I'm Safe</h2>
                  <p className="text-white/50 text-sm leading-relaxed">
                    Detect my location and navigate me to the
                    <strong className="text-white/80"> nearest shelter</strong> in Chandigarh
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-2 text-xs text-safe-400/70">
                    <Navigation className="h-3 w-3" /> Automatic shelter routing
                  </div>
                </div>
              </motion.button>

              {/* I Need Rescue */}
              <motion.button
                onClick={handleRescue}
                whileHover={{ scale: 1.02, y: -4 }}
                whileTap={{ scale: 0.98 }}
                className="glass border-2 border-danger-500/30 p-10 text-center hover:border-danger-400/50 
                           hover:bg-danger-500/5 transition-all duration-300 cursor-pointer group relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-danger-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="inline-flex p-5 bg-danger-500/15 rounded-full mb-6 group-hover:bg-danger-500/25 transition-colors animate-pulse-slow">
                    <AlertTriangle className="h-14 w-14 text-danger-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-danger-400 mb-3">I Need Rescue</h2>
                  <p className="text-white/50 text-sm leading-relaxed">
                    Send an <strong className="text-white/80">SOS signal</strong> with your GPS location.
                    Nearest rescue team will be dispatched immediately
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-2 text-xs text-danger-400/70">
                    <AlertTriangle className="h-3 w-3" /> Emergency dispatch
                  </div>
                </div>
              </motion.button>
            </motion.div>
            </>
          )}

          {/* ── LOCATING / ROUTING ──────────── */}
          {(step === STEP.LOCATING || step === STEP.ROUTING) && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md mx-auto glass border border-white/10 p-10 text-center"
            >
              <div className="relative inline-flex mb-6">
                <div className="w-20 h-20 rounded-full bg-electric-500/20 flex items-center justify-center">
                  {step === STEP.LOCATING
                    ? <MapPin className="h-10 w-10 text-electric-400 animate-bounce" />
                    : <Navigation className="h-10 w-10 text-electric-400 animate-spin" />
                  }
                </div>
                <div className="absolute inset-0 rounded-full border-2 border-electric-400/30 animate-ping" />
              </div>
              <h3 className="text-xl font-bold mb-2">
                {step === STEP.LOCATING ? "Detecting Location..." : "Calculating Route..."}
              </h3>
              <p className="text-white/40 text-sm">
                {step === STEP.LOCATING
                  ? "Please allow location access when prompted"
                  : "Finding the best route to a nearby shelter"
                }
              </p>
            </motion.div>
          )}

          {/* ── RESULT (safe route) ─────────── */}
          {step === STEP.RESULT && result && mode === "safe" && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              {/* Info bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: Home,      label: "Nearest Shelter",    value: result.shelter?.name || "Safe Shelter",             color: "text-safe-400"     },
                  { icon: Navigation,label: "Distance",           value: `${result.distance?.toFixed(2) || "—"} km`,          color: "text-electric-400" },
                  { icon: Clock,     label: "Est. Travel Time",   value: `~${result.estimatedTimeMinutes || "—"} min`,        color: "text-warning-400"  },
                ].map(({ icon: Icon, label, value, color }, i) => (
                  <div key={i} className="glass border border-white/10 p-4 text-center">
                    <Icon className={`h-6 w-6 ${color} mx-auto mb-2`} />
                    <p className="text-xs text-white/40 mb-1">{label}</p>
                    <p className={`font-bold ${color}`}>{value}</p>
                  </div>
                ))}
              </div>

              {result.shelter?.dataSource === "demo" && (
                <p className="text-center text-xs text-warning-400/80">
                  ⚠ This shelter is demonstration data, not a verified official Chandigarh shelter.
                </p>
              )}

              {/* Map */}
              <div className="glass border border-white/10 overflow-hidden rounded-2xl h-[420px]">
                <Suspense fallback={<div className="h-full flex items-center justify-center"><Spinner size="lg" /></div>}>
                  <RouteMap
                    userLocation={location}
                    targetLocation={result.shelter ? { lat: result.shelter.lat, lng: result.shelter.lng } : null}
                    route={result.route || []}
                    targetLabel={result.shelter?.name}
                    mode="shelter"
                  />
                </Suspense>
              </div>

              <div className="flex gap-4 justify-center">
                <button onClick={reset} className="btn-ghost border border-white/20 rounded-xl px-6 py-3 flex items-center gap-2">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <Link to="/dashboard" className="btn-primary px-6 py-3">View History</Link>
              </div>
            </motion.div>
          )}

          {/* ── SOS FORM ────────────────────── */}
          {step === STEP.SOS && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md mx-auto glass border border-danger-500/30 p-8"
            >
              <div className="text-center mb-6">
                <div className="inline-flex p-4 bg-danger-500/15 rounded-full mb-4">
                  <AlertTriangle className="h-10 w-10 text-danger-400" />
                </div>
                <h3 className="text-2xl font-bold text-danger-400 mb-2">Send SOS</h3>
                <p className="text-white/50 text-sm">Your GPS location will be shared with rescue teams</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm text-white/60 mb-2 block">Additional notes (optional)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Describe your situation (injuries, number of people, landmark...)"
                    rows={4}
                    className="input resize-none"
                  />
                </div>

                <button
                  onClick={submitRescue}
                  disabled={loading}
                  className="btn-danger w-full py-4 text-base flex items-center justify-center gap-2"
                >
                  {loading ? <><Spinner size="sm" /> Sending SOS...</> : <><AlertTriangle className="h-5 w-5" /> Send Emergency SOS</>}
                </button>

                <button onClick={reset} className="btn-ghost w-full py-3 text-sm" disabled={loading}>
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {/* ── SOS SENT ────────────────────── */}
          {step === STEP.SOS_SENT && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="max-w-xl mx-auto glass border border-danger-500/30 p-10 text-center"
            >
              <div className="relative inline-flex mb-6">
                <div className="w-24 h-24 rounded-full bg-danger-500/20 flex items-center justify-center">
                  <AlertTriangle className="h-12 w-12 text-danger-400" />
                </div>
                <div className="absolute inset-0 rounded-full border-2 border-danger-400/30 animate-ping" />
              </div>
              <h3 className="text-2xl font-bold text-danger-400 mb-3">SOS Sent!</h3>
              <p className="text-white/50 text-sm mb-6 leading-relaxed">
                Your location has been shared with our emergency team. A rescue unit will be assigned shortly.
                Keep your phone charged and stay in place if safe.
              </p>
              <div className="glass border border-white/10 p-4 text-left space-y-2 mb-6">
                <p className="text-xs text-white/40">Emergency ID</p>
                <p className="text-sm font-mono text-electric-400 break-all">{result?.emergency?._id}</p>
              </div>

              {/* Live status + rescue-team tracking for this SOS */}
              <div className="mb-6">
                <LiveRescueTracker emergencyId={result?.emergency?._id} />
              </div>
              <Link to="/dashboard" className="btn-primary w-full py-3 block">Track in Dashboard</Link>
            </motion.div>
          )}

          {/* ── OUTSIDE OPERATIONAL AREA ────── */}
          {step === STEP.OUTSIDE_AREA && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="max-w-md mx-auto glass border border-warning-500/30 p-10 text-center"
            >
              <div className="inline-flex p-5 bg-warning-500/15 rounded-full mb-6">
                <MapPin className="h-12 w-12 text-warning-400" />
              </div>
              <h3 className="text-2xl font-bold text-warning-400 mb-3">Outside Supported Area</h3>
              <p className="text-white/50 text-sm mb-6 leading-relaxed">
                QuakeCheck currently operates only within <strong className="text-white/80">Chandigarh, India</strong>.
                Your detected location is outside this area, so we can't route you to a shelter or
                dispatch a rescue team there yet.
              </p>
              <button onClick={reset} className="btn-ghost border border-white/20 rounded-xl px-6 py-3 flex items-center gap-2 mx-auto">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
