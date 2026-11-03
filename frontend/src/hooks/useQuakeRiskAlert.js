import { useEffect, useState } from "react";
import { feedApi } from "../api/dataApi";
import { getElevatedQuakes, RISK_SCAN_MIN_MAGNITUDE } from "../utils/earthquakeRisk";

/**
 * HIGH / CRITICAL QuakeCheck Risk quakes from the last 24 h.
 *
 * The feed list on the dashboard only shows the 8 newest events worldwide, so a
 * relevant quake could easily be missing from it. This asks the existing
 * /feed/earthquakes endpoint (existing `minMag` + `limit` params, no backend
 * change) for just the quakes that are big enough to ever be HIGH/CRITICAL,
 * then runs them through the shared risk utility.
 *
 * A failure is silent for the user (the alert is a bonus, not a dependency):
 * `elevated` stays empty and the page works exactly as before.
 */
export function useQuakeRiskAlert() {
  const [elevated, setElevated] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    feedApi
      .getEarthquakes({ limit: 100, minMag: RISK_SCAN_MIN_MAGNITUDE })
      .then(({ data }) => { if (!cancelled) setElevated(getElevatedQuakes(data?.earthquakes || [])); })
      .catch((e) => { console.warn("Risk scan failed:", e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { elevated, loading };
}
