import api from "./axios";

export const emergencyApi = {
  markSafe: (coords) => api.post("/emergency/safe", coords),
  requestRescue: (data) => api.post("/emergency/rescue", data),
  getMyEmergencies: () => api.get("/emergency/my"),
  getById: (id) => api.get(`/emergency/${id}`),
  getTracking: (id) => api.get(`/emergency/${id}/tracking`),
};
