import { useState, useEffect } from "react";
import { FlaskConical, MapPin, X, RotateCcw } from "lucide-react";
import {
  setSimulatedLocation,
  getSimulatedLocation,
  getSimulatedLabel,
  subscribeSimulatedLocation,
} from "../../dev/devLocation";

// Preset coordinates spread across real Chandigarh sectors, verified against
// the actual backend boundary polygon (backend/data/chandigarh-boundary.geojson)
// so every "inside" preset genuinely passes the real geofence check — this
// panel doesn't hardcode its own notion of what counts as Chandigarh, it just
// feeds coordinates into the same pipeline real GPS coordinates go through.
//
// Each sector is an AREA, not a single coordinate: "Point A" is the original
// preset coordinate (which happens to equal that sector's demo rescue-team
// base, so a victim there is 0 km / 0 min from that team), and B-D are nearby
// spots ~330-410 m away (all verified inside the geofence) so a simulated
// victim isn't always standing exactly on a team's base. Presets only choose a
// coordinate — rescue-team bases (backend/config/rescueBases.js), routing and
// live tracking are untouched.
const PRESETS = [
  {
    label: "Sector 17",
    points: [
      { name: "Point A", lat: 30.7430, lng: 76.7795 },
      { name: "Point B", lat: 30.7410, lng: 76.7828 },
      { name: "Point C", lat: 30.7452, lng: 76.7818 },
      { name: "Point D", lat: 30.7403, lng: 76.7766 },
    ],
  },
  {
    label: "Sector 22",
    points: [
      { name: "Point A", lat: 30.7270, lng: 76.7810 },
      { name: "Point B", lat: 30.7293, lng: 76.7834 },
      { name: "Point C", lat: 30.7246, lng: 76.7787 },
      { name: "Point D", lat: 30.7291, lng: 76.7783 },
    ],
  },
  {
    label: "Sector 35",
    points: [
      { name: "Point A", lat: 30.7265, lng: 76.7645 },
      { name: "Point B", lat: 30.7288, lng: 76.7669 },
      { name: "Point C", lat: 30.7242, lng: 76.7621 },
      { name: "Point D", lat: 30.7290, lng: 76.7619 },
    ],
  },
  {
    label: "Sector 43 (ISBT)",
    points: [
      { name: "Point A", lat: 30.7210, lng: 76.7490 },
      { name: "Point B", lat: 30.7233, lng: 76.7513 },
      { name: "Point C", lat: 30.7187, lng: 76.7467 },
      { name: "Point D", lat: 30.7236, lng: 76.7465 },
    ],
  },
  {
    label: "Sector 26",
    points: [
      { name: "Point A", lat: 30.7420, lng: 76.8050 },
      { name: "Point B", lat: 30.7443, lng: 76.8074 },
      { name: "Point C", lat: 30.7397, lng: 76.8027 },
      { name: "Point D", lat: 30.7441, lng: 76.8024 },
    ],
  },
  {
    label: "Manimajra",
    points: [
      { name: "Point A", lat: 30.7300, lng: 76.8230 },
      { name: "Point B", lat: 30.7323, lng: 76.8253 },
      { name: "Point C", lat: 30.7277, lng: 76.8207 },
      { name: "Point D", lat: 30.7321, lng: 76.8204 },
    ],
  },
];

const pointLabel = (sector, point) => `${sector.label} · ${point.name}`;

const OUTSIDE_PRESETS = [
  {
    label: "Outside Chandigarh (Panchkula)",
    lat: 30.6942,
    lng: 76.8606,
  },
  {
    label: "Outside Chandigarh (Zirakpur)",
    lat: 30.6425,
    lng: 76.8173,
  },
  {
    label: "Outside Chandigarh (Kharar)",
    lat: 30.7463,
    lng: 76.6467,
  },
];

export default function DevLocationSimulator() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => ({
    loc: getSimulatedLocation(),
    label: getSimulatedLabel(),
  }));
  const [customLat, setCustomLat] = useState("");
  const [customLng, setCustomLng] = useState("");

  useEffect(() => {
    return subscribeSimulatedLocation((loc, label) => setActive({ loc, label }));
  }, []);

  const apply = (preset) => setSimulatedLocation({ lat: preset.lat, lng: preset.lng }, preset.label);

  const applyCustom = () => {
    const lat = parseFloat(customLat);
    const lng = parseFloat(customLng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    setSimulatedLocation({ lat, lng }, `Custom (${lat}, ${lng})`);
  };

  // Which sector/point is currently simulated (derived from the label, so it
  // stays correct however the location was set).
  const activeSector = PRESETS.find((p) => p.points.some((pt) => pointLabel(p, pt) === active.label));
  const activePointIdx = activeSector
    ? activeSector.points.findIndex((pt) => pointLabel(activeSector, pt) === active.label)
    : -1;

  const applyPoint = (sector, idx) => {
    const pt = sector.points[idx];
    setSimulatedLocation({ lat: pt.lat, lng: pt.lng }, pointLabel(sector, pt));
  };

  // Clicking a sector picks a NEARBY point first (Point B), and clicking the
  // same sector again cycles B -> C -> D -> A, so repeatedly selecting a
  // sector doesn't always land on the exact base coordinate.
  const selectSector = (sector) =>
    applyPoint(sector, activeSector === sector ? (activePointIdx + 1) % sector.points.length : 1);

  const clear = () => setSimulatedLocation(null, null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2 bg-warning-500/90 hover:bg-warning-500
                   text-navy-950 font-semibold text-xs px-3 py-2 rounded-full shadow-lg border border-warning-300/50"
        title="Dev-only: simulate GPS location"
      >
        <FlaskConical className="h-3.5 w-3.5" />
        {active.loc ? `DEV: ${active.label}` : "DEV: Location Sim"}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-80 rounded-2xl border-2 border-dashed border-warning-400/60
                     bg-navy-950/98 shadow-2xl p-4 text-white">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-warning-400 font-bold text-sm">
          <FlaskConical className="h-4 w-4" /> DEV: Location Simulator
        </div>
        <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[11px] text-white/40 mb-3">
        Testing only — never shown in production. Real users always use their actual GPS.
      </p>

      <div className="mb-3 p-2 rounded-lg bg-white/5 text-xs flex items-center gap-2">
        <MapPin className="h-3.5 w-3.5 text-electric-400 flex-shrink-0" />
        {active.loc ? (
          <span>
            Simulating: <strong className="text-electric-400">{active.label}</strong>{" "}
            <span className="text-white/30">
              ({active.loc.lat.toFixed(4)}, {active.loc.lng.toFixed(4)})
            </span>
          </span>
        ) : (
          <span className="text-white/50">Using real GPS (no simulation active)</span>
        )}
      </div>

      <p className="text-[11px] uppercase tracking-wide text-white/30 mb-1.5">Chandigarh sectors</p>
      <div className="grid grid-cols-2 gap-1.5 mb-3">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => selectSector(p)}
            className={`text-xs px-2 py-1.5 rounded-lg text-safe-400 border text-left ${
              activeSector === p
                ? "bg-safe-500/25 border-safe-400/60"
                : "bg-safe-500/10 hover:bg-safe-500/20 border-safe-500/20"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {activeSector && (
        <div className="mb-3 -mt-1">
          <div className="flex gap-1.5">
            {activeSector.points.map((pt, i) => (
              <button
                key={pt.name}
                onClick={() => applyPoint(activeSector, i)}
                className={`flex-1 text-[11px] px-1.5 py-1 rounded-md border ${
                  i === activePointIdx
                    ? "bg-electric-500/25 border-electric-400/60 text-electric-400"
                    : "bg-white/5 hover:bg-white/10 border-white/10 text-white/60"
                }`}
              >
                {pt.name.replace("Point ", "")}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-white/30 mt-1">
            A = original coordinate (same as the demo team base there); B–D are ~350 m away. Click the sector again to cycle.
          </p>
        </div>
      )}

      <p className="text-[11px] uppercase tracking-wide text-white/30 mb-1.5">
  Outside boundary
</p>

<div className="grid grid-cols-1 gap-1.5 mb-3">
  {OUTSIDE_PRESETS.map((p) => (
    <button
      key={p.label}
      onClick={() => apply(p)}
      className="w-full text-xs px-2 py-1.5 rounded-lg bg-danger-500/10 hover:bg-danger-500/20 text-danger-400 border border-danger-500/20 text-left"
    >
      {p.label}
    </button>
  ))}
</div>

      <p className="text-[11px] uppercase tracking-wide text-white/30 mb-1.5">Custom coordinates</p>
      <div className="flex gap-1.5 mb-2">
        <input
          type="number" step="any" placeholder="Lat" value={customLat}
          onChange={(e) => setCustomLat(e.target.value)}
          className="input py-1.5 px-2 text-xs flex-1"
        />
        <input
          type="number" step="any" placeholder="Lng" value={customLng}
          onChange={(e) => setCustomLng(e.target.value)}
          className="input py-1.5 px-2 text-xs flex-1"
        />
        <button onClick={applyCustom} className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap">Use</button>
      </div>

      <button
        onClick={clear}
        disabled={!active.loc}
        className="w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-lg
                   bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white/60"
      >
        <RotateCcw className="h-3 w-3" /> Clear — use real GPS
      </button>
    </div>
  );
}
