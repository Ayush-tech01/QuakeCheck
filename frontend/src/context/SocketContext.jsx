import { createContext, useContext, useEffect, useRef } from "react";
import { getSocket } from "../lib/socket";
import { useAuth } from "./AuthContext";

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const socketRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem("qc_access_token");
    if (!user || !token) return;

    const socket = getSocket();
    socketRef.current = socket;

    // Join appropriate rooms
    if (user.role === "user") socket.emit("join:user", user._id);
    if (user.role === "admin") socket.emit("join:admin");
    if (user.role === "rescue_team") socket.emit("join:rescue", user._id);

    return () => {
      // Don't disconnect here — handled in AuthContext
    };
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
