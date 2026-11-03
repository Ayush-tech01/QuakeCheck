const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const Emergency = require("../models/Emergency");
const { buildTrackingSnapshot } = require("../services/trackingService");

let io;

const reply = (ack, payload) => {
  if (typeof ack === "function") ack(payload);
};

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:5173",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // ── Authentication ───────────────────────────────────────
  // The frontend has always sent `auth: { token }` on connect; it just wasn't
  // verified. Every socket must now present a valid access token, and its
  // identity/role come from that token — never from client-supplied IDs.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Authentication required"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("name role isActive");
      if (!user || !user.isActive) return next(new Error("User not found or inactive"));

      socket.data.user = { _id: user._id.toString(), role: user.role, name: user.name };
      next();
    } catch (err) {
      next(new Error(err.name === "TokenExpiredError" ? "Token expired" : "Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const me = socket.data.user;
    console.log(`🔌 Socket connected: ${socket.id} (${me.role})`);

    // Join the personal/role room that matches the *authenticated* identity.
    // Done on connect (not only on the client's join:* events) so rooms are
    // also restored automatically after a reconnect.
    const joinOwnRoom = () => {
      if (me.role === "user") socket.join(`user:${me._id}`);
      else if (me.role === "rescue_team") socket.join(`rescue:${me._id}`);
      else if (me.role === "admin") socket.join("admin");
    };
    joinOwnRoom();

    // Legacy join events are kept so the existing frontend keeps working, but
    // the room is always derived from the authenticated user; the ID the
    // client sends is ignored.
    socket.on("join:user", joinOwnRoom);
    socket.on("join:rescue", joinOwnRoom);
    socket.on("join:admin", joinOwnRoom);

    // ── Victim live tracking ───────────────────────────────
    // A victim (or an admin) subscribes to ONE emergency's live-tracking room.
    // Ownership is validated server-side on every subscribe.
    socket.on("emergency:subscribe", async (payload, ack) => {
      try {
        const emergencyId = payload?.emergencyId;
        if (!mongoose.isValidObjectId(emergencyId)) {
          return reply(ack, { ok: false, message: "Invalid emergency id" });
        }

        const emergency = await Emergency.findById(emergencyId);
        if (!emergency || emergency.type !== "rescue") {
          return reply(ack, { ok: false, message: "Emergency not found" });
        }

        const isOwner = me.role === "user" && emergency.user.toString() === me._id;
        if (!isOwner && me.role !== "admin") {
          return reply(ack, { ok: false, message: "Not authorized" });
        }

        socket.join(`emergency:${emergencyId}`);
        const tracking = await buildTrackingSnapshot(emergency);
        reply(ack, { ok: true, tracking });
      } catch (err) {
        console.warn("emergency:subscribe failed:", err.message);
        reply(ack, { ok: false, message: "Subscribe failed" });
      }
    });

    socket.on("emergency:unsubscribe", (payload) => {
      const emergencyId = payload?.emergencyId;
      if (mongoose.isValidObjectId(emergencyId)) socket.leave(`emergency:${emergencyId}`);
    });

    // NOTE: the old client-driven `rescue:location-update` relay was removed.
    // It forwarded whatever a client sent to any user room, so any socket
    // could spoof a rescue location to any victim. Rescue locations now only
    // flow through PATCH /api/rescue/location (authenticated, rescue_team
    // role), which derives the target victims from the team's own assigned
    // emergencies.

    socket.on("disconnect", () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
};

module.exports = initSocket;
module.exports.getIO = getIO;
