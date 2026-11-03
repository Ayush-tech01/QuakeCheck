import { Link, NavLink, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { Shield, Activity, Menu, X, LogOut, User, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/emergency", label: "Emergency", protected: true, roles: ["user"] },
  { to: "/dashboard", label: "My History", protected: true, roles: ["user"] },
  { to: "/admin", label: "Admin Panel", protected: true, roles: ["admin"] },
  { to: "/rescue", label: "Rescue Queue", protected: true, roles: ["rescue_team"] },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleLogout = async () => {
    setMobileOpen(false); // don't leave the mobile menu open under the logout toast
    setDropdownOpen(false);
    await logout();
    toast.success("Logged out successfully");
    navigate("/");
  };

  const visibleLinks = NAV_LINKS.filter((l) => {
    if (!l.protected) return true;
    if (!user) return false;
    return l.roles.includes(user.role);
  });

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <nav className="mx-4 mt-4 glass border-white/10 px-6 py-3 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <div className="p-1.5 bg-electric-500/20 rounded-lg group-hover:bg-electric-500/30 transition-colors">
            <Activity className="h-5 w-5 text-electric-400" />
          </div>
          <span className="font-bold text-lg">
            <span className="text-gradient">Quake</span>
            <span className="text-white">-Check</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {visibleLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className={({ isActive }) =>
                `px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-electric-500/20 text-electric-400"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>

        {/* Auth section */}
        <div className="hidden md:flex items-center gap-3">
          {user ? (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/10 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-electric-500/20 flex items-center justify-center">
                  <User className="h-4 w-4 text-electric-400" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-white leading-none">{user.name}</p>
                  <p className="text-xs text-white/40 capitalize">{user.role.replace("_", " ")}</p>
                </div>
                <ChevronDown className="h-4 w-4 text-white/40" />
              </button>
              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute right-0 mt-2 w-48 glass border border-white/10 shadow-xl overflow-hidden"
                  >
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-4 py-3 text-sm text-danger-400 hover:bg-danger-500/10 transition-colors"
                    >
                      <LogOut className="h-4 w-4" /> Logout
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <>
              <Link to="/login" className="btn-ghost text-sm">Login</Link>
              <Link to="/register" className="btn-primary text-sm py-2">Get Started</Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden p-2 rounded-xl hover:bg-white/10 transition-colors"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mx-4 mt-2 glass overflow-hidden"
          >
            <div className="p-4 flex flex-col gap-1">
              {visibleLinks.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === "/"}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `px-4 py-3 rounded-xl text-sm font-medium ${
                      isActive ? "bg-electric-500/20 text-electric-400" : "text-white/60"
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
              <div className="pt-2 border-t border-white/10 mt-2 flex flex-col gap-2">
                {user ? (
                  <button onClick={handleLogout} className="btn-ghost text-sm text-danger-400 text-left">
                    Logout
                  </button>
                ) : (
                  <>
                    <Link to="/login" className="btn-ghost text-sm" onClick={() => setMobileOpen(false)}>Login</Link>
                    <Link to="/register" className="btn-primary text-sm text-center" onClick={() => setMobileOpen(false)}>Get Started</Link>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
