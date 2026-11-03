const mongoose = require("mongoose");

const earthquakeFeedSchema = new mongoose.Schema(
  {
    eventId: { type: String, unique: true },
    magnitude: {
      type: Number,
      required: true,
      min: 0,
      max: 10,
    },
    place: { type: String, required: true },
    depth: { type: Number }, // km
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    time: { type: Date, required: true },
    tsunami: { type: Boolean, default: false },
    alert: {
      type: String,
      enum: ["green", "yellow", "orange", "red", null],
      default: null,
    },
    source: { type: String, default: "mock" },
  },
  { timestamps: true }
);

earthquakeFeedSchema.index({ time: -1 });
earthquakeFeedSchema.index({ magnitude: -1 });

module.exports = mongoose.model("EarthquakeFeed", earthquakeFeedSchema);
