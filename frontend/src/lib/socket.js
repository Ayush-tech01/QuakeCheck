import { io } from "socket.io-client";
import api from "../api/axios";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

let socket = null;
let lastToken = null;

export const getSocket = () => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ["websocket", "polling"],
      // The server verifies this token on every (re)connect. Using a callback
      // means automatic reconnects pick up the *latest* access token (the
      // axios interceptor rotates it every ~15 min) instead of a stale one.
      auth: (cb) => cb({ token: localStorage.getItem("qc_access_token") || lastToken }),
    });

    // The server verifies the access token at every (re)connect. If a reconnect
    // is refused because that token has expired (access tokens last ~15 min, so
    // this is routine after a backend restart or a network drop), socket.io
    // does NOT retry on its own (socket.active === false) and the page would
    // silently stay offline — no live assignment/tracking events ever arrive.
    // So: refresh the token through the axios interceptor (a 401 triggers the
    // refresh-token flow), then reconnect manually. Capped so a persistently
    // rejected token can't loop.
    let authRetries = 0;
    let authRetryTimer = null;
    socket.on("connect", () => { authRetries = 0; });
    socket.on("connect_error", (err) => {
      if (socket.active) return; // transient failure — socket.io retries itself
      if (!/expired/i.test(err?.message || "")) return;
      if (authRetryTimer || authRetries >= 3) return;
      authRetries += 1;
      authRetryTimer = setTimeout(async () => {
        authRetryTimer = null;
        try {
          await api.get("/auth/me");
          if (localStorage.getItem("qc_access_token")) socket.connect();
        } catch {
          /* refresh failed — axios interceptor already sends the user to /login */
        }
      }, 500);
    });
  }
  return socket;
};

export const connectSocket = (token) => {
  if (token) lastToken = token;
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
};

export const disconnectSocket = () => {
  lastToken = null;
  if (socket?.connected) {
    socket.disconnect();
  }
};
