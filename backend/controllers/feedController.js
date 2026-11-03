const EarthquakeFeed = require("../models/EarthquakeFeed");
const { boundingBoxFilter, isWithinRegion, resolveRegion } = require("../config/feedRegion");

// Regional requests read at most this many of the NEWEST events inside the
// region's bounding box before the exact distance check. Far more than a
// dashboard needs, and it keeps the query bounded as the collection grows.
const REGION_CANDIDATE_CAP = 1000;

// "Significant" earthquake threshold used by the stats below.
const SIGNIFICANT_MAGNITUDE = 5.0;

const regionInfo = (r) => ({ key: r.key, name: r.name, radiusKm: r.radiusKm, center: r.center });

// GET /api/feed/earthquakes
//   ?region=india  → only events within the India & nearby region (radius around
//                    Chandigarh, see config/feedRegion.js), newest first. Returns
//                    fewer than `limit` if fewer are relevant — never padded with
//                    unrelated events.
//   (no region)    → the global list, exactly as before.
exports.getEarthquakes = async (req, res, next) => {
  try {
    const { limit = 20, minMag, maxMag, page = 1 } = req.query;
    const region = resolveRegion(req.query.region);
    if (region === undefined) {
      return res.status(400).json({ success: false, message: `Unsupported region "${req.query.region}". Use region=india or omit it for the global feed.` });
    }

    const filter = {};
    if (minMag || maxMag) {
      filter.magnitude = {};
      if (minMag) filter.magnitude.$gte = parseFloat(minMag);
      if (maxMag) filter.magnitude.$lte = parseFloat(maxMag);
    }

    if (region) {
      const candidates = await EarthquakeFeed.find({ ...filter, ...boundingBoxFilter(region) })
        .sort({ time: -1, magnitude: -1 })
        .limit(REGION_CANDIDATE_CAP)
        .lean();
      const relevant = candidates.filter((q) => isWithinRegion(region, q.location));
      const regionalSkip = (parseInt(page) - 1) * parseInt(limit);

      return res.json({
        success: true,
        total: relevant.length,
        page: parseInt(page),
        limit: parseInt(limit),
        region: regionInfo(region),
        earthquakes: relevant.slice(regionalSkip, regionalSkip + parseInt(limit)),
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [earthquakes, total] = await Promise.all([
      EarthquakeFeed.find(filter)
        .sort({ time: -1 })
        .limit(parseInt(limit))
        .skip(skip)
        .lean(),
      EarthquakeFeed.countDocuments(filter),
    ]);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      earthquakes,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/feed/stats  (optional ?region=india, same scope as the feed above)
exports.getStats = async (req, res, next) => {
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const region = resolveRegion(req.query.region);
    if (region === undefined) {
      return res.status(400).json({ success: false, message: `Unsupported region "${req.query.region}". Use region=india or omit it for global stats.` });
    }
    if (region) {
      // Same shape as the global stats, computed over the regional events only.
      const docs = await EarthquakeFeed.find(boundingBoxFilter(region))
        .select("eventId magnitude time alert location")
        .lean();
      // eventId is unique in the model, but de-duplicate anyway so a stray duplicate
      // record can never inflate the counts shown on the homepage.
      const seen = new Set();
      const relevant = docs.filter((q) => {
        if (!isWithinRegion(region, q.location)) return false;
        const key = q.eventId || `${q.time}|${q.location?.lat}|${q.location?.lng}|${q.magnitude}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const byAlertMap = new Map();
      relevant.forEach((q) => byAlertMap.set(q.alert ?? null, (byAlertMap.get(q.alert ?? null) || 0) + 1));

      return res.json({
        success: true,
        stats: {
          total: relevant.length,
          today: relevant.filter((q) => q.time >= last24h).length,
          // `significant` has always been all-time; kept as is for compatibility.
          significant: relevant.filter((q) => q.magnitude >= SIGNIFICANT_MAGNITUDE).length,
          // M5+ in the last 24 h — what the homepage "Significant M5+" card shows.
          significantToday: relevant.filter((q) => q.magnitude >= SIGNIFICANT_MAGNITUDE && q.time >= last24h).length,
          byAlert: [...byAlertMap].map(([_id, count]) => ({ _id, count })),
        },
        region: regionInfo(region),
      });
    }

    const [total, today, significant, significantToday, byAlert] = await Promise.all([
      EarthquakeFeed.countDocuments(),
      EarthquakeFeed.countDocuments({ time: { $gte: last24h } }),
      EarthquakeFeed.countDocuments({ magnitude: { $gte: SIGNIFICANT_MAGNITUDE } }),
      EarthquakeFeed.countDocuments({ magnitude: { $gte: SIGNIFICANT_MAGNITUDE }, time: { $gte: last24h } }),
      EarthquakeFeed.aggregate([
        { $group: { _id: "$alert", count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      success: true,
      stats: {
        total,
        today,
        significant,
        significantToday,
        byAlert,
      },
    });
  } catch (err) {
    next(err);
  }
};
