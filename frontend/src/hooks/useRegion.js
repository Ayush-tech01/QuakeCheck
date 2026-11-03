import { useState, useEffect } from "react";
import { regionApi } from "../api/dataApi";
import { CHANDIGARH_CENTER } from "../config/region";

/**
 * Fetches the app's operational region (Chandigarh) — center, bounds, and
 * boundary GeoJSON — from the backend, which is the single source of truth
 * for the actual geofence polygon. Falls back to the static display center
 * if the request hasn't resolved yet or fails, so maps still render sensibly.
 */
export const useRegion = () => {
  const [region, setRegion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    regionApi
      .getRegion()
      .then(({ data }) => {
        if (!cancelled) setRegion(data.region);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load region info");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    region,
    boundary: region?.boundary ?? null,
    bounds: region?.bounds ?? null,
    center: region?.center ? [region.center.lat, region.center.lng] : CHANDIGARH_CENTER,
    loading,
    error,
  };
};
