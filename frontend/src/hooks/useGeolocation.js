import { useState, useEffect, useCallback } from "react";
import { getSimulatedLocation } from "../dev/devLocation";

export const useGeolocation = () => {
  const [location, setLocation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const getLocation = useCallback(() => {
    // DEV-ONLY: if a developer has set a simulated coordinate via the dev
    // panel, use it instead of calling the real Geolocation API. This whole
    // branch is behind import.meta.env.DEV, which Vite replaces with the
    // literal `false` in production builds — so this check, and the dev
    // simulator module it imports, are dead-code-eliminated and never ship
    // to real users. Real users always hit the code below unchanged.
    if (import.meta.env.DEV) {
      const sim = getSimulatedLocation();
      if (sim) {
        setLocation(sim);
        setError(null);
        setLoading(false);
        return Promise.resolve(sim);
      }
    }

    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return Promise.reject("Geolocation not supported");
    }

    setLoading(true);
    setError(null);

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLocation(coords);
          setLoading(false);
          resolve(coords);
        },
        (err) => {
          let msg = "Unable to retrieve your location";
          if (err.code === 1) msg = "Location access denied. Please allow location access.";
          if (err.code === 2) msg = "Location unavailable. Please try again.";
          if (err.code === 3) msg = "Location request timed out.";
          setError(msg);
          setLoading(false);
          reject(msg);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    });
  }, []);

  return { location, error, loading, getLocation };
};
