const User = require("../models/User");
const { getBusyTeamMap } = require("../services/teamRecommendationService");

// GET /api/stats/rescue-teams   (public — counts only, no names or locations)
//
// The homepage needs to show how many rescue teams exist, but /api/admin/rescue-teams
// is admin-only and returns full user records. This returns just the numbers.
//   total        every registered rescue_team account
//   unavailable  accounts that are inactive (isActive: false)
//   busy         active accounts holding an assigned / en_route emergency
//   available    active accounts with none of those
// Availability is derived from Emergency data exactly as the admin dashboard does
// (services/teamRecommendationService), so the two always agree.
exports.getRescueTeamSummary = async (_req, res, next) => {
  try {
    const teams = await User.find({ role: "rescue_team" }).select("_id isActive").lean();
    const active = teams.filter((t) => t.isActive !== false);
    const busyMap = await getBusyTeamMap(active.map((t) => t._id));
    const busy = active.filter((t) => busyMap.has(String(t._id))).length;

    res.json({
      success: true,
      rescueTeams: {
        total: teams.length,
        available: active.length - busy,
        busy,
        unavailable: teams.length - active.length,
      },
    });
  } catch (err) {
    next(err);
  }
};
