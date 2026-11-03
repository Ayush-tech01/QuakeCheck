// Safe, non-destructive way to give the EXISTING rescue-team accounts their
// base locations (config/rescueBases.js).
//
//   npm run set-bases
//
// Unlike `npm run seed` this never deletes or recreates anything: it only
// $sets `baseLocation` on users that already exist (matched by e-mail and
// role "rescue_team"), so emergencies, assignments, passwords and each team's
// live `location` are untouched. Safe to run repeatedly.
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const RESCUE_BASES = require("../config/rescueBases");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/quakecheck";

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    let missing = 0;

    for (const { email, label, baseLocation } of RESCUE_BASES) {
      const res = await User.updateOne(
        { email, role: "rescue_team" },
        { $set: { baseLocation } }
      );
      if (res.matchedCount === 0) {
        missing += 1;
        console.warn(`⚠️  No rescue_team user with e-mail ${email} (${label}) — skipped`);
      } else {
        console.log(`✅ ${label} (${email}) → base "${baseLocation.name}" (${baseLocation.lat}, ${baseLocation.lng})`);
      }
    }

    const noBase = await User.find({
      role: "rescue_team",
      $or: [{ "baseLocation.lat": { $exists: false } }, { "baseLocation.lng": { $exists: false } }],
    }).select("name email");
    if (noBase.length) {
      console.warn("\n⚠️  Rescue teams still WITHOUT a base location (they won't be recommended):");
      noBase.forEach((u) => console.warn(`   - ${u.name} <${u.email}>`));
    }

    const total = await User.countDocuments({ role: "rescue_team" });
    console.log(`\nDone. ${RESCUE_BASES.length - missing}/${RESCUE_BASES.length} bases applied; ${total} rescue-team accounts in DB (none created).`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed:", err.message);
    process.exit(1);
  }
})();
