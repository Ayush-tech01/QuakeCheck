require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Shelter = require("../models/Shelter");
const EarthquakeFeed = require("../models/EarthquakeFeed");
const Emergency = require("../models/Emergency");
const RESCUE_BASES = require("../config/rescueBases");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/quakecheck";

// ─── Seed Data ────────────────────────────────────────────

// Phone numbers below are fictional DEMO numbers (Indian format), not real contacts.
const users = [
  {
    name: "Demo User",
    email: "user@qc.com",
    password: "qc123456",
    role: "user",
    phone: "+91 98765 10001",
  },
  {
    name: "Admin Officer",
    email: "admin@qc.com",
    password: "qc123456",
    role: "admin",
    phone: "+91 98765 10002",
  },
  {
    name: "Rescue Team Alpha",
    email: "rescue@qc.com",
    password: "qc123456",
    role: "rescue_team",
    phone: "+91 98765 10003",
  },
  {
    name: "Rescue Team Bravo",
    email: "rescue2@qc.com",
    password: "qc123456",
    role: "rescue_team",
    phone: "+91 98765 10004",
  },
  {
    name: "Rescue Team Charlie",
    email: "rescue3@qc.com",
    password: "qc123456",
    role: "rescue_team",
    phone: "+91 98765 10005",
  },
  {
    name: "Rescue Team Delta",
    email: "rescue4@qc.com",
    password: "qc123456",
    role: "rescue_team",
    phone: "+91 98765 10006",
  },
  {
    name: "Rescue Team Echo",
    email: "rescue5@qc.com",
    password: "qc123456",
    role: "rescue_team",
    phone: "+91 98765 10007",
  },
  {
    name: "Rescue Team Foxtrot",
    email: "rescue6@qc.com",
    password: "qc123456",
    role: "rescue_team",
    phone: "+91 98765 10008",
  },
];

// NOTE ON SHELTER DATA: These are DEMONSTRATION shelters only. Locations are
// placed at real, publicly-known Chandigarh sectors/landmarks so the map
// looks and behaves realistically, but these are NOT verified official
// emergency shelters — no Chandigarh Administration source has confirmed
// capacity, occupancy, or operational status for these coordinates. Every
// record is tagged dataSource: "demo" (see Shelter model) and the frontend
// must visibly label them as demo data. Replace with verified data (e.g.
// from the Chandigarh Administration or NDMA) before any real-world use.
const shelters = [
  { name: "[DEMO] Sector 17 Community Center", location: { lat: 30.7410, lng: 76.7828 }, address: "Sector 17, Chandigarh", capacity: 500, currentOccupancy: 120, facilities: ["food", "water", "medical", "beds"], contactPhone: "+91-172-555-0201", dataSource: "demo" },
  { name: "[DEMO] Sector 22 Relief Camp", location: { lat: 30.7295, lng: 76.7776 }, address: "Sector 22, Chandigarh", capacity: 300, currentOccupancy: 80, facilities: ["food", "water", "beds"], contactPhone: "+91-172-555-0202", dataSource: "demo" },
  { name: "[DEMO] Sector 35 Shelter Hub", location: { lat: 30.7245, lng: 76.7689 }, address: "Sector 35, Chandigarh", capacity: 400, currentOccupancy: 200, facilities: ["food", "water", "medical", "power"], contactPhone: "+91-172-555-0203", dataSource: "demo" },
  { name: "[DEMO] Manimajra Emergency Depot", location: { lat: 30.7275, lng: 76.8264 }, address: "Manimajra, Chandigarh", capacity: 600, currentOccupancy: 50, facilities: ["food", "water", "medical", "power", "wifi", "beds"], contactPhone: "+91-172-555-0204", dataSource: "demo" },
  { name: "[DEMO] Sector 43 ISBT Safe House", location: { lat: 30.7186, lng: 76.7461 }, address: "Sector 43, Chandigarh", capacity: 250, currentOccupancy: 100, facilities: ["food", "water", "beds"], contactPhone: "+91-172-555-0205", dataSource: "demo" },
  { name: "[DEMO] Panjab University Relief Camp", location: { lat: 30.7593, lng: 76.7676 }, address: "Sector 14, Chandigarh", capacity: 450, currentOccupancy: 0, facilities: ["food", "water", "medical", "power", "wifi", "beds"], contactPhone: "+91-172-555-0206", dataSource: "demo" },
  { name: "[DEMO] Sector 46 Refuge", location: { lat: 30.7099, lng: 76.7684 }, address: "Sector 46, Chandigarh", capacity: 200, currentOccupancy: 75, facilities: ["food", "water"], contactPhone: "+91-172-555-0207", dataSource: "demo" },
  { name: "[DEMO] Industrial Area Emergency Center", location: { lat: 30.7046, lng: 76.8005 }, address: "Industrial Area Phase 1, Chandigarh", capacity: 350, currentOccupancy: 180, facilities: ["food", "water", "medical", "beds"], contactPhone: "+91-172-555-0208", dataSource: "demo" },
  { name: "[DEMO] Sector 26 Evacuation Zone", location: { lat: 30.7318, lng: 76.8039 }, address: "Sector 26 Grain Market, Chandigarh", capacity: 280, currentOccupancy: 30, facilities: ["food", "water", "power"], contactPhone: "+91-172-555-0209", dataSource: "demo" },
  { name: "[DEMO] Sector 39 Mega Shelter", location: { lat: 30.7185, lng: 76.7565 }, address: "Sector 39, Chandigarh", capacity: 800, currentOccupancy: 250, facilities: ["food", "water", "medical", "power", "wifi", "beds"], contactPhone: "+91-172-555-0210", dataSource: "demo" },
];

const quakes = [
  { eventId: "qc001", magnitude: 5.2, place: "15km NE of San Francisco, CA", depth: 12, location: { lat: 37.8200, lng: -122.3000 }, time: new Date(Date.now() - 1000 * 60 * 30), alert: "yellow" },
  { eventId: "qc002", magnitude: 3.8, place: "5km SW of Oakland, CA", depth: 8, location: { lat: 37.7800, lng: -122.3100 }, time: new Date(Date.now() - 1000 * 60 * 90), alert: "green" },
  { eventId: "qc003", magnitude: 6.1, place: "50km off coast of Eureka, CA", depth: 25, location: { lat: 40.8021, lng: -124.3000 }, time: new Date(Date.now() - 1000 * 60 * 180), tsunami: true, alert: "red" },
  { eventId: "qc004", magnitude: 4.5, place: "10km SE of Napa, CA", depth: 15, location: { lat: 38.2500, lng: -122.2000 }, time: new Date(Date.now() - 1000 * 60 * 240), alert: "green" },
  { eventId: "qc005", magnitude: 2.9, place: "2km N of Hayward, CA", depth: 5, location: { lat: 37.6725, lng: -122.0808 }, time: new Date(Date.now() - 1000 * 60 * 350), alert: null },
  { eventId: "qc006", magnitude: 5.8, place: "30km W of Santa Cruz, CA", depth: 18, location: { lat: 36.9741, lng: -122.4194 }, time: new Date(Date.now() - 1000 * 60 * 480), alert: "orange" },
  { eventId: "qc007", magnitude: 3.3, place: "8km N of Berkeley, CA", depth: 10, location: { lat: 37.9200, lng: -122.2700 }, time: new Date(Date.now() - 1000 * 60 * 600), alert: null },
  { eventId: "qc008", magnitude: 4.0, place: "20km S of San Jose, CA", depth: 14, location: { lat: 37.2000, lng: -121.8900 }, time: new Date(Date.now() - 1000 * 60 * 720), alert: "green" },
  { eventId: "qc009", magnitude: 6.5, place: "100km NW of Sacramento, CA", depth: 30, location: { lat: 39.0000, lng: -122.1000 }, time: new Date(Date.now() - 1000 * 60 * 900), tsunami: false, alert: "red" },
  { eventId: "qc010", magnitude: 2.5, place: "3km E of Fremont, CA", depth: 7, location: { lat: 37.5485, lng: -121.9000 }, time: new Date(Date.now() - 1000 * 60 * 1200), alert: null },
  { eventId: "qc011", magnitude: 4.7, place: "12km NE of Livermore, CA", depth: 11, location: { lat: 37.7000, lng: -121.6600 }, time: new Date(Date.now() - 1000 * 60 * 1440), alert: "yellow" },
  { eventId: "qc012", magnitude: 5.5, place: "45km S of Monterey, CA", depth: 20, location: { lat: 36.1500, lng: -121.6000 }, time: new Date(Date.now() - 1000 * 60 * 1800), alert: "orange" },
  { eventId: "qc013", magnitude: 3.1, place: "6km W of Walnut Creek, CA", depth: 9, location: { lat: 37.8900, lng: -122.1300 }, time: new Date(Date.now() - 1000 * 60 * 2160), alert: null },
  { eventId: "qc014", magnitude: 4.3, place: "25km E of Sacramento, CA", depth: 13, location: { lat: 38.5800, lng: -121.2000 }, time: new Date(Date.now() - 1000 * 60 * 2520), alert: "green" },
  { eventId: "qc015", magnitude: 5.9, place: "70km W of San Luis Obispo, CA", depth: 22, location: { lat: 35.2828, lng: -121.3000 }, time: new Date(Date.now() - 1000 * 60 * 2880), alert: "orange" },
  { eventId: "qc016", magnitude: 2.7, place: "1km N of Concord, CA", depth: 6, location: { lat: 37.9800, lng: -122.0300 }, time: new Date(Date.now() - 1000 * 60 * 3240), alert: null },
  { eventId: "qc017", magnitude: 6.8, place: "200km off coast of Crescent City, CA", depth: 40, location: { lat: 42.0000, lng: -124.8000 }, time: new Date(Date.now() - 1000 * 60 * 3600), tsunami: true, alert: "red" },
  { eventId: "qc018", magnitude: 3.5, place: "4km S of Pleasanton, CA", depth: 8, location: { lat: 37.6400, lng: -121.8700 }, time: new Date(Date.now() - 1000 * 60 * 4320), alert: null },
  { eventId: "qc019", magnitude: 4.9, place: "18km NW of San Rafael, CA", depth: 16, location: { lat: 38.1200, lng: -122.7000 }, time: new Date(Date.now() - 1000 * 60 * 4680), alert: "yellow" },
  { eventId: "qc020", magnitude: 5.3, place: "35km SE of Fort Bragg, CA", depth: 19, location: { lat: 39.2000, lng: -123.5000 }, time: new Date(Date.now() - 1000 * 60 * 5040), alert: "yellow" },
  // Demo events near Chandigarh, seeded so the local Chandigarh risk-assessment
  // panel has something to show during development without waiting on a live
  // USGS sync. These are illustrative only, not real recorded events.
  { eventId: "qc-ch-001", magnitude: 4.6, place: "12km NE of Chandigarh, India", depth: 10, location: { lat: 30.85, lng: 76.90 }, time: new Date(Date.now() - 1000 * 60 * 45), alert: null },
  { eventId: "qc-ch-002", magnitude: 5.1, place: "Kangra, Himachal Pradesh, India", depth: 15, location: { lat: 32.099, lng: 76.269 }, time: new Date(Date.now() - 1000 * 60 * 60 * 6), alert: "yellow" },
  { eventId: "qc-ch-003", magnitude: 4.2, place: "Dehradun, Uttarakhand, India", depth: 20, location: { lat: 30.316, lng: 78.032 }, time: new Date(Date.now() - 1000 * 60 * 60 * 20), alert: null },
];

// ─── Seed Function ────────────────────────────────────────

const seed = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Clear existing data
    await User.deleteMany({});
    await Shelter.deleteMany({});
    await EarthquakeFeed.deleteMany({});
    // Emergency records reference User/Shelter/RescueTeam IDs that just got
    // wiped and regenerated above, so leaving old Emergency documents in
    // place orphans them (they'd point at accounts that no longer exist).
    // Clearing this too keeps every reseed a fully consistent, self-contained
    // demo state rather than accumulating stale, broken-reference history.
    await Emergency.deleteMany({});
    console.log("🗑️  Cleared existing collections");

    // Seed users (passwords hashed via pre-save hook)
    const createdUsers = await User.insertMany(
      await Promise.all(
        users.map(async (u) => {
          const salt = await bcrypt.genSalt(12);
          // Rescue teams also get their configured base location (see
          // config/rescueBases.js); live `location` is left unset.
          const base = RESCUE_BASES.find((b) => b.email === u.email);
          return {
            ...u,
            ...(base ? { baseLocation: base.baseLocation } : {}),
            password: await bcrypt.hash(u.password, salt),
          };
        })
      )
    );
    console.log(`👤 Seeded ${createdUsers.length} users`);

    // Seed shelters
    const createdShelters = await Shelter.insertMany(shelters);
    console.log(`🏠 Seeded ${createdShelters.length} shelters`);

    // Seed earthquakes
    const createdQuakes = await EarthquakeFeed.insertMany(quakes);
    console.log(`🌍 Seeded ${createdQuakes.length} earthquake events`);

    console.log("\n✨ Database seeded successfully!");
    console.log("──────────────────────────────────");
    console.log("Demo accounts (password: qc123456):");
    console.log("  👤 user@qc.com    — User");
    console.log("  🛡️  admin@qc.com   — Admin");
    console.log("  🚑 rescue@qc.com  — Rescue Team");
    console.log("──────────────────────────────────\n");

    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
};

seed();
