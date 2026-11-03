import { useEffect, useState } from "react";
import { getSocket } from "../lib/socket";
import { emergencyApi } from "../api/emergencyApi";

const TERMINAL = ["resolved", "cancelled"];

/**
 * Live rescue-team tracking for ONE of the victim's own emergencies.
 *
 * - Loads the latest snapshot over REST (works after refresh / from history).
 * - Subscribes to the emergency's server-validated Socket.IO room and applies
 *   `emergency:trackingUpdate` events as they arrive (marker + route + ETA).
 * - Re-subscribes (and re-syncs from the ack snapshot) after every reconnect.
 * - Follows `emergency:status` so assignment / en-route / resolved flip the
 *   UI without a refresh, and stops listening once the SOS is finished.
 * - Removes every listener it added on unmount / when `emergencyId` changes.
 *
 * Pass a falsy `emergencyId` to keep the hook idle.
 */
export function useRescueTracking(emergencyId) {
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!emergencyId) {
      setTracking(null);
      setError(null);
      return undefined;
    }

    const socket = getSocket();
    let cancelled = false;
    let finished = false;

    // clockOffsetMs lets the UI compute "updated X ago" from the server's
    // clock, so a wrong device clock can't make a live team look stale.
    const withOffset = (t) => ({
      ...t,
      clockOffsetMs: t.serverTime ? new Date(t.serverTime).getTime() - Date.now() : 0,
    });

    const applySnapshot = (snap) => {
      if (cancelled || !snap) return;
      setTracking((prev) => ({ ...(prev || {}), ...withOffset(snap) }));
      if (TERMINAL.includes(snap.status)) stopLive();
    };

    const fetchSnapshot = async () => {
      try {
        const { data } = await emergencyApi.getTracking(emergencyId);
        applySnapshot(data.tracking);
        if (!cancelled) setError(null);
      } catch {
        if (!cancelled) setError("Couldn't load rescue tracking");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const subscribe = () => {
      if (finished) return;
      socket.emit("emergency:subscribe", { emergencyId }, (res) => {
        if (res?.ok) applySnapshot(res.tracking);
      });
    };

    function stopLive() {
      if (finished) return;
      finished = true;
      socket.emit("emergency:unsubscribe", { emergencyId });
    }

    const onTrackingUpdate = (p) => {
      if (cancelled || finished || String(p?.emergencyId) !== String(emergencyId)) return;
      setTracking((prev) => {
        if (!prev) return prev; // snapshot not loaded yet — it will be newer than this event
        const next = { ...prev, teamLocation: p.teamLocation };
        if (p.serverTime) next.clockOffsetMs = new Date(p.serverTime).getTime() - Date.now();
        // Route fields are only present when the backend recalculated the route.
        if (p.routeStatus !== undefined) {
          next.route = p.route || [];
          next.distance = p.distance ?? null;
          next.estimatedTime = p.estimatedTime ?? null;
          next.routeStatus = p.routeStatus;
        }
        return next;
      });
    };

    const onStatus = (p) => {
      if (cancelled || String(p?.emergencyId) !== String(emergencyId)) return;
      setTracking((prev) =>
        prev ? { ...prev, status: p.status, team: p.team || prev.team } : prev
      );
      if (TERMINAL.includes(p.status)) {
        setTracking((prev) => (prev ? { ...prev, teamLocation: null, route: [] } : prev));
        stopLive();
      } else {
        // assigned / en_route: pull the team's last known location + route.
        fetchSnapshot();
      }
    };

    setLoading(true);
    fetchSnapshot();

    socket.on("emergency:trackingUpdate", onTrackingUpdate);
    socket.on("emergency:status", onStatus);
    socket.on("connect", subscribe); // (re)join the room after any reconnect
    if (socket.connected) subscribe();

    return () => {
      cancelled = true;
      socket.off("emergency:trackingUpdate", onTrackingUpdate);
      socket.off("emergency:status", onStatus);
      socket.off("connect", subscribe);
      if (!finished) socket.emit("emergency:unsubscribe", { emergencyId });
    };
  }, [emergencyId]);

  return { tracking, loading, error };
}
