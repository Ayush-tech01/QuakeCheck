const axios = require("axios");
const EarthquakeFeed = require("../models/EarthquakeFeed");

const USGS_API_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch data from USGS API and update the database
 */
const syncUSGSEarthquakes = async () => {
  try {
    console.log("🔄 Fetching live earthquake data from USGS...");
    const { data } = await axios.get(USGS_API_URL, { timeout: 15000 });
    
    if (!data || !data.features) {
      console.error("❌ Invalid data format received from USGS.");
      return;
    }

    let newCount = 0;
    let updateCount = 0;

    // Process each earthquake feature
    for (const feature of data.features) {
      const { id, properties, geometry } = feature;
      const { mag, place, time, tsunami, alert } = properties;
      
      // USGS sometimes has negative magnitude or null, but our schema min is 0. 
      // Cap at 0 to satisfy schema.
      const magnitude = mag !== null ? Math.max(0, mag) : 0;
      
      const [lng, lat, depth] = geometry.coordinates;

      const eventData = {
        eventId: id,
        magnitude,
        place,
        depth: depth || 0,
        location: { lat, lng },
        time: new Date(time),
        tsunami: !!tsunami,
        alert: alert && ["green", "yellow", "orange", "red"].includes(alert) ? alert : null,
        source: "usgs",
      };

      // Upsert into database
      const result = await EarthquakeFeed.updateOne(
        { eventId: id },
        { $set: eventData },
        { upsert: true }
      );

      if (result.upsertedCount > 0) newCount++;
      else if (result.modifiedCount > 0) updateCount++;
    }

    console.log(`✅ USGS Sync complete: Added ${newCount} | Updated ${updateCount} new events.`);
  } catch (err) {
    console.error("❌ USGS Sync failed:", err.message);
  }
};

/**
 * Start the background synchronization process
 */
const startUSGSSync = () => {
  // Run immediately on start
  syncUSGSEarthquakes();
  
  // Then run periodically
  setInterval(syncUSGSEarthquakes, SYNC_INTERVAL);
};

module.exports = { syncUSGSEarthquakes, startUSGSSync };
