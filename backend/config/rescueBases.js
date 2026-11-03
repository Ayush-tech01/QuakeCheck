// Configurable BASE locations for the six seeded rescue-team accounts.
//
// These are PROJECT / DEMO coordinates used only to estimate which team could
// reach a new SOS fastest (base -> victim, by road). They are not real
// emergency-station locations and the UI must not present them as such.
//
// Teams are matched by account e-mail (the seed order Alpha..Foxtrot is
// "Rescue Team 1..6"), so the existing users are updated in place rather than
// recreated. This is the single source of truth: utils/seedData.js and
// utils/setRescueBases.js both read it, and the frontend only ever receives
// these values through the API.
//
// A base is NOT the team's live position: that stays in User.location
// (written from GPS by PATCH /api/rescue/location) and is what Priority 3
// live tracking uses after assignment.
module.exports = [
  { email: "rescue@qc.com",  label: "Rescue Team 1", baseLocation: { name: "Sector 17",         lat: 30.7430, lng: 76.7795 } },
  { email: "rescue2@qc.com", label: "Rescue Team 2", baseLocation: { name: "Sector 22",         lat: 30.7270, lng: 76.7810 } },
  { email: "rescue3@qc.com", label: "Rescue Team 3", baseLocation: { name: "Sector 35",         lat: 30.7265, lng: 76.7645 } },
  { email: "rescue4@qc.com", label: "Rescue Team 4", baseLocation: { name: "Sector 43 / ISBT",  lat: 30.7210, lng: 76.7490 } },
  { email: "rescue5@qc.com", label: "Rescue Team 5", baseLocation: { name: "Manimajra",         lat: 30.7300, lng: 76.8230 } },
  { email: "rescue6@qc.com", label: "Rescue Team 6", baseLocation: { name: "Sector 26",         lat: 30.7420, lng: 76.8050 } },
];
