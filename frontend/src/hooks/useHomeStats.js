import { useEffect, useState } from "react";
import { feedApi, shelterApi, statsApi } from "../api/dataApi";

// One refresh cycle for every homepage statistic card.
export const HOME_STATS_REFRESH_MS = 5 * 60 * 1000;

const EMPTY = { status: "loading", data: null };

/**
 * Live numbers for the four homepage stat cards, each from its real source:
 *   quakes   → GET /feed/stats?region=india   (today = last 24 h, significantToday = M5+ in last 24 h)
 *   shelters → GET /shelters                  (active shelters only: isActive: true)
 *   teams    → GET /stats/rescue-teams        (registered / available / busy / unavailable)
 *
 * - Loads once on mount, then every 5 minutes with a single timer.
 * - The three requests are independent: one failing never blanks the others.
 * - A failed refresh keeps the last good numbers (status "error" tells the UI to say so);
 *   there are no placeholder/fallback figures — before the first success `data` is null.
 * - Skips scheduled refreshes while the tab is hidden and catches up when it becomes visible.
 * - Cleans up its timer, listener and any in-flight requests on unmount.
 */
export function useHomeStats() {
  const [state, setState] = useState({ quakes: EMPTY, shelters: EMPTY, teams: EMPTY });

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let lastLoadedAt = 0;
    const controller = new AbortController();

    const merge = (key, result, pick) =>
      setState((prev) =>
        result.status === "fulfilled"
          ? { ...prev, [key]: { status: "ok", data: pick(result.value.data) } }
          : { ...prev, [key]: { status: "error", data: prev[key].data } }
      );

    const load = async () => {
      if (inFlight || cancelled) return; // never stack requests
      inFlight = true;
      const opts = { signal: controller.signal };
      const [quakes, shelters, teams] = await Promise.allSettled([
        feedApi.getStats({ region: "india" }, opts),
        shelterApi.getAll(opts),
        statsApi.getRescueTeams(opts),
      ]);
      inFlight = false;
      if (cancelled) return;
      lastLoadedAt = Date.now();

      merge("quakes", quakes, (d) => ({
        today: d?.stats?.today ?? null,
        significantToday: d?.stats?.significantToday ?? null,
      }));
      merge("shelters", shelters, (d) => ({
        active: Number.isFinite(d?.count) ? d.count : Array.isArray(d?.shelters) ? d.shelters.length : null,
        // seeded demo shelters are flagged in the data; never present them as official
        allDemo: Array.isArray(d?.shelters) && d.shelters.length > 0 && d.shelters.every((x) => x.dataSource === "demo"),
      }));
      merge("teams", teams, (d) => d?.rescueTeams ?? null);
    };

    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, HOME_STATS_REFRESH_MS);

    // Back on the tab after a long absence: refresh now instead of waiting for the next tick.
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastLoadedAt >= HOME_STATS_REFRESH_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return state;
}
