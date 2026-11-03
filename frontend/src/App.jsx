import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Emergency from "./pages/Emergency";
import Dashboard from "./pages/Dashboard";
import AdminDashboard from "./pages/AdminDashboard";
import RescueDashboard from "./pages/RescueDashboard";
import Spinner from "./components/common/Spinner";
import DevLocationSimulator from "./components/dev/DevLocationSimulator";

// Protected route wrapper
const ProtectedRoute = ({ children, roles }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner size="lg" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
};

const AppRoutes = () => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner size="lg" /></div>;

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={user ? <Navigate to={getDashboard(user.role)} replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to={getDashboard(user.role)} replace /> : <Register />} />
      <Route path="/emergency" element={
        <ProtectedRoute roles={["user"]}><Emergency /></ProtectedRoute>
      } />
      <Route path="/dashboard" element={
        <ProtectedRoute roles={["user"]}><Dashboard /></ProtectedRoute>
      } />
      <Route path="/admin" element={
        <ProtectedRoute roles={["admin"]}><AdminDashboard /></ProtectedRoute>
      } />
      <Route path="/rescue" element={
        <ProtectedRoute roles={["rescue_team"]}><RescueDashboard /></ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const getDashboard = (role) => {
  if (role === "admin") return "/admin";
  if (role === "rescue_team") return "/rescue";
  return "/dashboard";
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <AppRoutes />
          {/* DEV-ONLY: mounted globally so both Emergency and RescueDashboard
              benefit from the same simulated coordinate via useGeolocation().
              import.meta.env.DEV is statically false in production builds,
              so Vite dead-code-eliminates this whole branch (and the
              DevLocationSimulator import along with it) — it never ships. */}
          {import.meta.env.DEV && <DevLocationSimulator />}
          {/* top-right, but pushed BELOW the fixed navbar (≈16px margin + ≈64px bar).
              At top:16 the toasts sat on top of the navbar's Login / Get Started
              buttons — exactly where you land after logging out. */}
          <Toaster
            position="top-right"
            containerStyle={{ top: 92, right: 16, left: 16 }}
            toastOptions={{
              style: {
                background: "#0d1528", color: "#fff", border: "1px solid rgba(255,255,255,0.1)",
                maxWidth: "min(360px, calc(100vw - 32px))",
              },
              duration: 4000,
            }}
          />
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
