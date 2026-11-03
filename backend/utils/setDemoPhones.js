// Updates the phone numbers of the EXISTING demo accounts to the fictional
// Indian-format DEMO numbers used by utils/seedData.js — without re-seeding.
//
//   npm run set-demo-phones
//
// `npm run seed` deletes all users and emergencies; this does not. It only
// $sets `phone` on the eight demo accounts (matched by e-mail), touches no
// other field, and is safe to run repeatedly. Keep this map in sync with the
// phones in seedData.js. These are NOT real contacts.
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/quakecheck";

const DEMO_PHONES = {
  "user@qc.com": "+91 98765 10001",
  "admin@qc.com": "+91 98765 10002",
  "rescue@qc.com": "+91 98765 10003",
  "rescue2@qc.com": "+91 98765 10004",
  "rescue3@qc.com": "+91 98765 10005",
  "rescue4@qc.com": "+91 98765 10006",
  "rescue5@qc.com": "+91 98765 10007",
  "rescue6@qc.com": "+91 98765 10008",
};

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    let missing = 0;
    for (const [email, phone] of Object.entries(DEMO_PHONES)) {
      const res = await User.updateOne({ email }, { $set: { phone } });
      if (res.matchedCount === 0) {
        missing += 1;
        console.warn(`⚠️  No user with e-mail ${email} — skipped`);
      } else {
        console.log(`✅ ${email} → ${phone}`);
      }
    }
    console.log(`\nDone. ${Object.keys(DEMO_PHONES).length - missing}/${Object.keys(DEMO_PHONES).length} demo phones updated (no accounts created or deleted).`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed:", err.message);
    process.exit(1);
  }
})();
