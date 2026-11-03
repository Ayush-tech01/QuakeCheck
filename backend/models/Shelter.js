const mongoose = require("mongoose");

const shelterSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Shelter name is required"],
      trim: true,
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    address: { type: String },
    capacity: {
      type: Number,
      required: true,
      min: [1, "Capacity must be at least 1"],
    },
    currentOccupancy: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    facilities: [
      {
        type: String,
        enum: ["food", "water", "medical", "power", "wifi", "beds"],
      },
    ],
    contactPhone: { type: String },
    manager: { type: String },
    // Distinguishes shelters seeded for demonstration purposes from
    // shelters backed by verified, official Chandigarh Administration data.
    // The frontend surfaces this so demo data is never presented as official.
    dataSource: {
      type: String,
      enum: ["demo", "verified"],
      default: "demo",
    },
  },
  { timestamps: true }
);

shelterSchema.virtual("availableSpots").get(function () {
  return Math.max(0, this.capacity - this.currentOccupancy);
});

shelterSchema.virtual("occupancyPercent").get(function () {
  return Math.round((this.currentOccupancy / this.capacity) * 100);
});

shelterSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Shelter", shelterSchema);
