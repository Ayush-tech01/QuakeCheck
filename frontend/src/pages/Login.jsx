import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Mail, Lock, Eye, EyeOff, ArrowRight, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";
import Spinner from "../components/common/Spinner";

// ── Demo quick-login accounts (seeded by backend/utils/seedData.js). DEMO ONLY —
// this just pre-fills the normal login() call; it is not a separate auth path.
const DEMO_PASSWORD = "qc123456";
const DEMO_ACCOUNTS = {
  user:  { email: "user@qc.com",  password: DEMO_PASSWORD },
  admin: { email: "admin@qc.com", password: DEMO_PASSWORD },
};
// The six rescue teams, in seed order (rescue@qc.com = Alpha … rescue6@qc.com = Foxtrot).
const RESCUE_TEAMS = [
  { key: "alpha",   name: "Alpha",   email: "rescue@qc.com",  password: DEMO_PASSWORD },
  { key: "bravo",   name: "Bravo",   email: "rescue2@qc.com", password: DEMO_PASSWORD },
  { key: "charlie", name: "Charlie", email: "rescue3@qc.com", password: DEMO_PASSWORD },
  { key: "delta",   name: "Delta",   email: "rescue4@qc.com", password: DEMO_PASSWORD },
  { key: "echo",    name: "Echo",    email: "rescue5@qc.com", password: DEMO_PASSWORD },
  { key: "foxtrot", name: "Foxtrot", email: "rescue6@qc.com", password: DEMO_PASSWORD },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  // Rescue quick-login: the button only opens this chooser; nothing is sent until "Continue".
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);

  const validate = () => {
    const e = {};
    if (!form.email) e.email = "Email required";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Invalid email";
    if (!form.password) e.password = "Password required";
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      toast.success(`Welcome back, ${user.name}!`);
      if (user.role === "admin") navigate("/admin");
      else if (user.role === "rescue_team") navigate("/rescue");
      else navigate("/dashboard");
    } catch (err) {
      toast.error(err.response?.data?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // Shared by every quick-login button (user, admin and each rescue team).
  const runQuickLogin = async (acc, label) => {
    setForm({ email: acc.email, password: acc.password });
    setLoading(true);
    try {
      const user = await login(acc.email, acc.password);
      toast.success(`Logged in as ${label}`);
      if (user.role === "admin") navigate("/admin");
      else if (user.role === "rescue_team") navigate("/rescue");
      else navigate("/dashboard");
    } catch (err) {
      toast.error(err.response?.data?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = (role) => {
    if (role === "rescue_team") {
      setShowTeamPicker((open) => !open); // show the chooser — do NOT log in yet
      return;
    }
    setShowTeamPicker(false);
    return runQuickLogin(DEMO_ACCOUNTS[role], role);
  };

  const continueAsTeam = () => {
    const team = RESCUE_TEAMS.find((t) => t.key === selectedTeam);
    if (team) runQuickLogin(team, `Rescue Team ${team.name}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-20 bg-grid">
      {/* BG orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/4 w-72 h-72 bg-electric-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-72 h-72 bg-danger-500/6 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="p-2 bg-electric-500/20 rounded-xl">
              <Activity className="h-6 w-6 text-electric-400" />
            </div>
            <span className="text-2xl font-bold">
              <span className="text-gradient">Quake</span>-Check
            </span>
          </Link>
          <p className="text-white/40 mt-3 text-sm">Sign in to your account</p>
        </div>

        <div className="glass border border-white/10 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="text-sm text-white/60 mb-1.5 block">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  type="email"
                  className={`input pl-10 ${errors.email ? "border-danger-500/50 focus:ring-danger-500/30" : ""}`}
                  placeholder="you@email.com"
                  value={form.email}
                  onChange={(e) => { setForm({ ...form, email: e.target.value }); setErrors({ ...errors, email: "" }); }}
                />
              </div>
              {errors.email && <p className="text-danger-400 text-xs mt-1">{errors.email}</p>}
            </div>

            {/* Password */}
            <div>
              <label className="text-sm text-white/60 mb-1.5 block">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  type={showPwd ? "text" : "password"}
                  className={`input pl-10 pr-10 ${errors.password ? "border-danger-500/50 focus:ring-danger-500/30" : ""}`}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => { setForm({ ...form, password: e.target.value }); setErrors({ ...errors, password: "" }); }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-danger-400 text-xs mt-1">{errors.password}</p>}
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 flex items-center justify-center gap-2">
              {loading ? <Spinner size="sm" /> : <>Sign In <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>

          {/* Quick login buttons */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <p className="text-xs text-white/30 text-center mb-3">Quick demo login</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { role: "user",        label: "👤 User",   cls: "border-electric-500/30 text-electric-400" },
                { role: "admin",       label: "🛡️ Admin",  cls: "border-warning-500/30 text-warning-400"  },
                { role: "rescue_team", label: "🚑 Rescue", cls: "border-danger-500/30 text-danger-400"    },
              ].map(({ role, label, cls }) => (
                <button
                  key={role}
                  onClick={() => quickLogin(role)}
                  disabled={loading}
                  className={`text-xs py-2 px-3 glass border rounded-xl hover:bg-white/10 transition-all ${cls}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Rescue team chooser (opened by the Rescue button) */}
            <AnimatePresence initial={false}>
              {showTeamPicker && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 glass border border-danger-500/30 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-white/60">Select Rescue Team</p>
                      <button
                        type="button"
                        aria-label="Close team selection"
                        onClick={() => setShowTeamPicker(false)}
                        className="text-white/30 hover:text-white/60"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div role="radiogroup" aria-label="Rescue team" className="grid grid-cols-3 gap-2">
                      {RESCUE_TEAMS.map((t) => {
                        const active = selectedTeam === t.key;
                        return (
                          <button
                            key={t.key}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={loading}
                            onClick={() => setSelectedTeam(t.key)}
                            className={`text-xs py-2 px-2 rounded-lg border transition-all ${
                              active
                                ? "bg-danger-500/20 border-danger-400/70 text-danger-400 font-semibold"
                                : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                            }`}
                          >
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={continueAsTeam}
                      disabled={!selectedTeam || loading}
                      className="btn-primary w-full mt-3 py-2 text-xs flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      {loading ? <Spinner size="sm" /> : <>Continue <ArrowRight className="h-3.5 w-3.5" /></>}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <p className="text-center text-sm text-white/40 mt-4">
            No account?{" "}
            <Link to="/register" className="text-electric-400 hover:text-electric-300 font-medium">
              Register free
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
