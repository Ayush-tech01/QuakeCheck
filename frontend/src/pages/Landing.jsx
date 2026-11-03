import { useEffect, useState, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Activity, Shield, MapPin, Zap, Users, AlertTriangle,
  CheckCircle, ArrowRight, Radio, Navigation, Heart
} from "lucide-react";
import Navbar from "../components/common/Navbar";
import Footer from "../components/common/Footer";
import StatCard from "../components/cards/StatCard";
import EarthquakeCard from "../components/cards/EarthquakeCard";
import Spinner from "../components/common/Spinner";
import QuakeRiskNotice from "../components/cards/QuakeRiskNotice";
import { feedApi } from "../api/dataApi";
import { useQuakeRiskAlert } from "../hooks/useQuakeRiskAlert";
import { useHomeStats } from "../hooks/useHomeStats";
import { dedupeQuakes } from "../utils/earthquakeRisk";

const QuakeMap = lazy(() => import("../components/map/QuakeMap"));

const FEATURES = [
  { icon: Radio,      title: "Live Earthquake Feed",       desc: "Real-time seismic data updated continuously from monitoring stations worldwide.",          color: "blue" },
  { icon: Navigation, title: "Smart Shelter Routing",    desc: "Automatically finds and routes you to the nearest available shelter in Chandigarh.",        color: "green" },
  { icon: AlertTriangle, title: "SOS Rescue Request",     desc: "One tap sends your GPS coordinates to the nearest rescue team with live route tracking.",  color: "red" },
  { icon: Shield,     title: "Role-Based Access",          desc: "Separate dashboards for citizens, rescue teams, and administrators.",                      color: "blue" },
  { icon: Zap,        title: "Real-Time Socket Updates",   desc: "Socket.IO keeps rescue teams and victims synchronized with live location streaming.",      color: "yellow" },
  { icon: Users,      title: "Rescue Coordination",        desc: "Admins assign nearest available teams and track all active operations from one view.",     color: "green" },
];

const HOW_IT_WORKS = [
  { step: "01", icon: CheckCircle,   color: "text-safe-400",     title: "I'm Safe",      desc: "GPS detects your location and finds the nearest open shelter in Chandigarh." },
  { step: "02", icon: AlertTriangle, color: "text-danger-400",   title: "I Need Rescue", desc: "SOS request sent instantly. Admin assigns nearest rescue team. Live route shared." },
  { step: "03", icon: Navigation,    color: "text-electric-400", title: "Team En Route", desc: "Rescue team navigates to your position. You track them in real-time on the map." },
];

// Value + sub-line for a stat card from one live data source ({ status, data }).
// Loading → "…"; no data and failed → "—" / "Unavailable"; a failed REFRESH keeps the
// last real numbers and says so. A genuine 0 is shown as 0, never as a placeholder.
function statCard({ icon, label, color, src, sub, pick }) {
  const value = src.data ? (pick(src.data) ?? "—") : src.status === "loading" ? "…" : "—";
  const text = src.status === "error" ? (src.data ? "Last update failed" : "Unavailable") : sub;
  return { icon, label, color, value, sub: text };
}

// "4 available · 2 busy" (+ "· 1 unavailable" only when some accounts are inactive)
function teamsSub({ total, available, busy, unavailable }) {
  if (!total) return "none registered";
  return [`${available} available`, `${busy} busy`, unavailable > 0 ? `${unavailable} unavailable` : null]
    .filter(Boolean)
    .join(" · ");
}

const fadeUp = { initial: { opacity: 0, y: 30 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true } };

export default function Landing() {
  const [earthquakes, setEarthquakes] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [feedError, setFeedError] = useState(false);
  // HIGH / CRITICAL QuakeCheck Risk quakes (last 24 h); empty → no alert is shown at all.
  const { elevated } = useQuakeRiskAlert();
  // The four stat cards: real counts, refreshed together every 5 minutes.
  const homeStats = useHomeStats();

  useEffect(() => {
    const load = async () => {
      try {
        // Dashboard shows India & nearby only; the risk alert hook keeps its own global scan.
        const eqRes = await feedApi.getEarthquakes({ limit: 8, region: "india" });
        setEarthquakes(dedupeQuakes(eqRes.data.earthquakes || []));
      } catch (e) {
        console.error("Feed load failed:", e.message);
        setFeedError(true);
      } finally {
        setLoadingFeed(false);
      }
    };
    load();
  }, []);

  return (
    <div className="min-h-screen bg-grid">
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────── */}
      <section className="relative pt-36 pb-20 px-6 overflow-hidden">
        {/* BG orbs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-electric-500/8 rounded-full blur-3xl" />
          <div className="absolute top-40 right-1/4 w-80 h-80 bg-danger-500/6 rounded-full blur-3xl" />
        </div>

        <div className="max-w-5xl mx-auto text-center relative">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-2 glass border border-electric-500/30 rounded-full text-electric-400 text-sm mb-8"
          >
            <span className="pulse-dot" />
            Live Seismic Monitoring Active
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl md:text-7xl font-black tracking-tight mb-6 leading-tight"
          >
            Stay Safe During
            <br />
            <span className="text-gradient">Earthquakes</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Real-time earthquake tracking, intelligent shelter routing,
            and instant SOS rescue coordination — all in one platform for Chandigarh.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link
              to="/emergency"
              className="btn-primary text-base px-8 py-4 flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              <Shield className="h-5 w-5" />
              Check My Safety
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/register"
              className="btn-ghost text-base px-8 py-4 border border-white/20 rounded-xl w-full sm:w-auto text-center"
            >
              Create Account
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── Stats ──────────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              statCard({ icon: Activity,      label: "Events Today",    color: "red",    src: homeStats.quakes,   sub: "India & nearby, 24h",
                         pick: (d) => d.today }),
              statCard({ icon: Shield,        label: "Shelters Online", color: "green",  src: homeStats.shelters,
                         sub: homeStats.shelters.data?.allDemo ? "active · demo data" : "active shelters",
                         pick: (d) => d.active }),
              statCard({ icon: AlertTriangle, label: "Significant M5+", color: "yellow", src: homeStats.quakes,   sub: "India & nearby, 24h",
                         pick: (d) => d.significantToday }),
              statCard({ icon: Users,         label: "Rescue Teams",    color: "blue",   src: homeStats.teams,
                         sub: homeStats.teams.data ? teamsSub(homeStats.teams.data) : "registered",
                         pick: (d) => d.total }),
            ].map((s, i) => (
              <StatCard key={i} {...s} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Live Feed + Map ──────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeUp} className="text-center mb-10">
            <h2 className="section-title mb-3">Live Earthquake Activity</h2>
            <p className="text-white/40 text-sm">India &amp; Nearby Region</p>
          </motion.div>

          {/* Contextual alert — only appears for HIGH / CRITICAL QuakeCheck Risk */}
          {elevated.length > 0 && (
            <div className="mb-6 max-w-3xl mx-auto">
              <QuakeRiskNotice items={elevated} variant="compact" />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Feed list */}
            <div className="lg:col-span-2 space-y-3">
              {loadingFeed ? (
                <Spinner className="py-12" />
              ) : earthquakes.length === 0 ? (
                <p className="text-center text-white/30 py-12">
                  {feedError
                    ? "Couldn't load earthquake data right now"
                    : "No recent significant earthquake activity detected in the India & nearby region."}
                </p>
              ) : (
                earthquakes.map((q, i) => <EarthquakeCard key={q._id || i} quake={q} index={i} />)
              )}
            </div>

            {/* Map */}
            <div className="lg:col-span-3 rounded-2xl overflow-hidden border border-white/10 h-[500px]">
              <Suspense fallback={<div className="h-full flex items-center justify-center"><Spinner size="lg" /></div>}>
                <QuakeMap earthquakes={earthquakes} />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeUp} className="text-center mb-12">
            <h2 className="section-title mb-3">Everything You Need</h2>
            <p className="text-white/40 max-w-xl mx-auto">
              From seismic monitoring to rescue coordination — Quake-Check covers every stage of disaster response.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => {
              const colorMap = {
                blue:   { bg: "bg-electric-500/10", text: "text-electric-400" },
                red:    { bg: "bg-danger-500/10",   text: "text-danger-400"   },
                green:  { bg: "bg-safe-500/10",     text: "text-safe-400"     },
                yellow: { bg: "bg-warning-500/10",  text: "text-warning-400"  },
              };
              const c = colorMap[f.color];
              return (
                <motion.div
                  key={i}
                  {...fadeUp}
                  transition={{ delay: i * 0.08 }}
                  whileHover={{ y: -6 }}
                  className="glass border border-white/10 p-6 hover:border-electric-500/20 transition-all duration-300"
                >
                  <div className={`inline-flex p-3 rounded-xl ${c.bg} mb-4`}>
                    <f.icon className={`h-6 w-6 ${c.text}`} />
                  </div>
                  <h3 className="font-semibold text-white mb-2">{f.title}</h3>
                  <p className="text-white/40 text-sm leading-relaxed">{f.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div {...fadeUp} className="text-center mb-12">
            <h2 className="section-title mb-3">How It Works</h2>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {HOW_IT_WORKS.map((step, i) => (
              <motion.div
                key={i}
                {...fadeUp}
                transition={{ delay: i * 0.1 }}
                className="glass border border-white/10 p-6 text-center"
              >
                <p className="text-5xl font-black text-white/5 mb-2">{step.step}</p>
                <step.icon className={`h-8 w-8 ${step.color} mx-auto mb-3 -mt-8`} />
                <h3 className="font-semibold text-white mb-2">{step.title}</h3>
                <p className="text-white/40 text-sm leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            {...fadeUp}
            className="glass border border-electric-500/20 p-12 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-electric-500/5 to-danger-500/5 pointer-events-none" />
            <Heart className="h-12 w-12 text-danger-400 mx-auto mb-6 animate-pulse-slow" />
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Don't Wait for a Disaster
            </h2>
            <p className="text-white/50 mb-8 leading-relaxed">
              Register now and know your nearest shelter before you need it.
              In an emergency, every second counts.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/register" className="btn-primary px-8 py-4 text-base">
                Create Free Account
              </Link>
              <Link to="/emergency" className="btn-danger px-8 py-4 text-base">
                Emergency Now
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
