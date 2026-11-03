const mongoose = require("mongoose");

const emergencySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["safe", "rescue"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "assigned", "en_route", "resolved", "cancelled"],
      default: "pending",
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: { type: String },
    },
    assignedTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    shelter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shelter",
    },
    route: [
      {
        lat: Number,
        lng: Number,
      },
    ],
    routeDistance: Number, // in km
    estimatedTime: Number, // in minutes
    // Coordinate the current `route` was actually computed from (the rescue
    // team's location at that time). Used to decide whether a subsequent
    // location update has moved far enough to justify recalculating —
    // avoids re-routing on every small GPS jitter.
    routeOrigin: {
      lat: { type: Number },
      lng: { type: Number },
    },
    // Distinguishes "no route yet" from "we tried and the routing service
    // couldn't produce one" so the frontend can show an honest state instead
    // of silently falling back to a fake line.
    routeStatus: {
      type: String,
      enum: ["pending", "ok", "unavailable"],
      default: "pending",
    },
    notes: { type: String },
    resolvedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Index for quick queries
emergencySchema.index({ status: 1, createdAt: -1 });
emergencySchema.index({ user: 1, createdAt: -1 });
emergencySchema.index({ assignedTeam: 1, status: 1 });

module.exports = mongoose.model("Emergency", emergencySchema);
