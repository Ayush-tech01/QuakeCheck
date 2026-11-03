import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authApi } from "../api/authApi";
import { connectSocket, disconnectSocket } from "../lib/socket";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const initUser = useCallback(async () => {
    const token = localStorage.getItem("qc_access_token");
    if (!token) { setLoading(false); return; }
    try {
      const { data } = await authApi.getMe();
      setUser(data.user);
      connectSocket(token);
    } catch {
      localStorage.removeItem("qc_access_token");
      localStorage.removeItem("qc_refresh_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { initUser(); }, [initUser]);

  const login = async (email, password) => {
    const { data } = await authApi.login({ email, password });
    localStorage.setItem("qc_access_token", data.accessToken);
    localStorage.setItem("qc_refresh_token", data.refreshToken);
    setUser(data.user);
    connectSocket(data.accessToken);
    return data.user;
  };

  const register = async (name, email, password, phone) => {
    const { data } = await authApi.register({ name, email, password, phone });
    localStorage.setItem("qc_access_token", data.accessToken);
    localStorage.setItem("qc_refresh_token", data.refreshToken);
    setUser(data.user);
    connectSocket(data.accessToken);
    return data.user;
  };

  const logout = async () => {
    try { await authApi.logout(); } catch {}
    localStorage.removeItem("qc_access_token");
    localStorage.removeItem("qc_refresh_token");
    disconnectSocket();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};
