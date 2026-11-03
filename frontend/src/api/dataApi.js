import api from "./axios";

export const shelterApi = {
  getAll: (config) => api.get("/shelters", config),
  getById: (id) => api.get(`/shelters/${id}`),
};

export const feedApi = {
  // params.region = "india" → India & nearby region only; omit for the global feed.
  getEarthquakes: (params) => api.get("/feed/earthquakes", { params }),
  getStats: (params, config) => api.get("/feed/stats", { params, ...config }),
};

export const statsApi = {
  // Public aggregate counts { total, available, busy, unavailable } — no names or locations.
  getRescueTeams: (config) => api.get("/stats/rescue-teams", config),
};

export const regionApi = {
  // Chandigarh operational area: center, bounds, and boundary GeoJSON.
  // Kept as a single backend-sourced call so the frontend never maintains
  // its own copy of the geofence polygon that could drift from the one
  // actually enforced server-side.
  getRegion: () => api.get("/region"),
};

export const adminApi = {
  getAllEmergencies: (params) => api.get("/admin/emergencies", { params }),
  getStats: () => api.get("/admin/stats"),
  getRescueTeams: () => api.get("/admin/rescue-teams"),
  assignTeam: (emergencyId, teamId) =>
    api.patch(`/admin/emergencies/${emergencyId}/assign`, { teamId }),
  updateStatus: (emergencyId, status) =>
    api.patch(`/admin/emergencies/${emergencyId}/status`, { status }),
  // Fastest available team by road ETA from each team's base (recommend only).
  getTeamRecommendations: (emergencyId) =>
    api.get(`/admin/emergencies/${emergencyId}/recommendations`),
  // Advisory ML severity analysis (read-only). Without `scenario`, the backend analyses
  // the strongest recent nearby earthquake; with it, a manual what-if run:
  // { magnitude, depth, latitude, longitude }.
  analyzeSeverity: (emergencyId, scenario) =>
    api.post(`/admin/emergencies/${emergencyId}/severity`, scenario ? { scenario } : {}),
  // Historical earthquake similarity (KNN; read-only, informational, separate from the severity
  // analysis above). Without `scenario` it compares the earthquake matched to this SOS; with it,
  // a HYPOTHETICAL scenario: { magnitude, depth, latitude, longitude }.
  findSimilarEarthquakes: (emergencyId, scenario) =>
    api.post(`/admin/emergencies/${emergencyId}/similar-earthquakes`, scenario ? { scenario } : {}),
};

export const rescueApi = {
  getAssigned: () => api.get("/rescue/assigned"),
  markEnRoute: (id) => api.patch(`/rescue/en-route/${id}`),
  complete: (id) => api.patch(`/rescue/complete/${id}`),
  updateLocation: (data) => api.patch("/rescue/location", data),
};
