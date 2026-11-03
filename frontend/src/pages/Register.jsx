import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, User, Mail, Lock, Phone, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";
import Spinner from "../components/common/Spinner";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPwd: "", phone: "" });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Name required";
    if (!form.email) e.email = "Email required";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Invalid email";
    if (!form.password) e.password = "Password required";
    else if (form.password.length < 6) e.password = "Min 6 characters";
    if (form.password !== form.confirmPwd) e.confirmPwd = "Passwords do not match";
    return e;
  };

  const handleChange = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value });
    setErrors({ ...errors, [field]: "" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      await register(form.name, form.email, form.password, form.phone);
      toast.success("Account created! Welcome to Quake-Check.");
      navigate("/dashboard");
    } catch (err) {
      toast.error(err.response?.data?.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    { key: "name",       label: "Full name",       type: "text",     icon: User,  placeholder: "Jane Smith"       },
    { key: "email",      label: "Email address",   type: "email",    icon: Mail,  placeholder: "you@email.com"     },
    { key: "phone",      label: "Phone (optional)", type: "tel",     icon: Phone, placeholder: "+91 98765 43210"   },
    { key: "password",   label: "Password",         type: showPwd ? "text" : "password", icon: Lock, placeholder: "At least 6 chars", toggle: true },
    { key: "confirmPwd", label: "Confirm password", type: showPwd ? "text" : "password", icon: Lock, placeholder: "Repeat password" },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-24 bg-grid">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-72 h-72 bg-electric-500/8 rounded-full blur-3xl" />
      </div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md relative">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="p-2 bg-electric-500/20 rounded-xl">
              <Activity className="h-6 w-6 text-electric-400" />
            </div>
            <span className="text-2xl font-bold"><span className="text-gradient">Quake</span>-Check</span>
          </Link>
          <p className="text-white/40 mt-3 text-sm">Create your free account</p>
        </div>

        <div className="glass border border-white/10 p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {fields.map(({ key, label, type, icon: Icon, placeholder, toggle }) => (
              <div key={key}>
                <label className="text-sm text-white/60 mb-1.5 block">{label}</label>
                <div className="relative">
                  <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                  <input
                    type={type}
                    value={form[key]}
                    onChange={handleChange(key)}
                    placeholder={placeholder}
                    className={`input pl-10 ${toggle ? "pr-10" : ""} ${errors[key] ? "border-danger-500/50" : ""}`}
                  />
                  {toggle && (
                    <button type="button" onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                {errors[key] && <p className="text-danger-400 text-xs mt-1">{errors[key]}</p>}
              </div>
            ))}

            <button type="submit" disabled={loading}
              className="btn-primary w-full py-3.5 flex items-center justify-center gap-2 mt-6">
              {loading ? <Spinner size="sm" /> : <>Create Account <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>

          <p className="text-center text-sm text-white/40 mt-4">
            Already have an account?{" "}
            <Link to="/login" className="text-electric-400 hover:text-electric-300 font-medium">Sign in</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
