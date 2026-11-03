// DEV-ONLY location simulation store.
//
// This module exists purely to let developers test Chandigarh-area flows
// (geofence, shelter routing, SOS) without needing to physically be there or
// fight browser DevTools location overrides. It is NOT part of the real user
// flow in any way:
//
//   - Real users' coordinates always come from navigator.geolocation.
//   - This store is only ever read from inside `if (import.meta.env.DEV)`
//     guards (see useGeolocation.js), which Vite statically evaluates and
//     dead-code-eliminates in production builds — so in a real `npm run
//     build`, none of this code (or the panel that sets it) ships at all.
//   - Setting a simulated coordinate here does NOT touch the Chandigarh
//     geofence in any way. The backend's isInsideChandigarh() check runs
//     identically regardless of where a coordinate came from — this store
//     only changes what coordinate gets fed in, never how it's validated.
//
// Simple module-level state (not React state) so both the dev panel
// component and the geolocation hook can read/write it without needing a
// context provider wired through the whole app.

let simulatedLocation = null;
let simulatedLabel = null;
const listeners = new Set();

/** Set (or clear, with null) the coordinate dev builds should use instead of real GPS. */
export function setSimulatedLocation(loc, label = null) {
  simulatedLocation = loc;
  simulatedLabel = label;
  listeners.forEach((fn) => fn(simulatedLocation, simulatedLabel));
}

export function getSimulatedLocation() {
  return simulatedLocation;
}

export function getSimulatedLabel() {
  return simulatedLabel;
}

/** Subscribe to changes (used by the dev panel to reflect current state). Returns an unsubscribe fn. */
export function subscribeSimulatedLocation(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
