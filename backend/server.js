/**
 * Quake-Check Backend — Entry Point
 * Express + Socket.IO + MongoDB
 */
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const morgan = require("morgan");

const connectDB = require("./config/db");
const initSocket = require("./config/socket");
const errorHandler = require("./middleware/errorHandler");

// Route imports
const authRoutes = require("./routes/auth");
const emergencyRoutes = require("./routes/emergency");
const shelterRoutes = require("./routes/shelter");
const adminRoutes = require("./routes/admin");
const rescueRoutes = require("./routes/rescue");
const feedRoutes = require("./routes/feed");
const regionRoutes = require("./routes/region");
const statsRoutes = require("./routes/stats");

// ── App Setup ──────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// Connect to MongoDB
connectDB();

// Init Socket.IO (attach to server)
const io = initSocket(server);

// ── Middleware ─────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Make io accessible in controllers
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// ── API Routes ─────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/emergency", emergencyRoutes);
app.use("/api/shelters", shelterRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/rescue", rescueRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/region", regionRoutes);
app.use("/api/stats", statsRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "quake-check-api", timestamp: new Date() });
});

// ── Error Handler ──────────────────────────────────────────
app.use(errorHandler);

const { startUSGSSync } = require("./services/usgsSyncService");

// ── Server Start ───────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 Quake-Check API running on port ${PORT}`);
  console.log(`📡 Socket.IO ready`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}\n`);
  
  // Start background sync for USGS earthquake data
  startUSGSSync();
});

module.exports = { app, server };
