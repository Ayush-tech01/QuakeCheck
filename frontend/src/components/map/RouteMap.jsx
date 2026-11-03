import { MapContainer, TileLayer, Marker, Polyline, Popup, ZoomControl, useMap, GeoJSON } from "react-leaflet";
import { useEffect } from "react";
import { Icon, divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useRegion } from "../../hooks/useRegion";
import { CHANDIGARH_CENTER, CHANDIGARH_CITY_ZOOM } from "../../config/region";

const CARTO_API_KEY = import.meta.env.VITE_CARTO_API_KEY;

// Fix default icon
delete Icon.Default.prototype._getIconUrl;
Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const shelterIcon = divIcon({
  html: `<div style="background:#22c55e;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 0 8px rgba(34,197,94,0.6)"></div>`,
  className: "",
  iconAnchor: [7, 7],
});

const userIcon = divIcon({
  html: `<div style="background:#3b82f6;width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(59,130,246,0.7)"></div>`,
  className: "",
  iconAnchor: [8, 8],
});

const rescueIcon = divIcon({
  html: `<div style="background:#ef4444;width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(239,68,68,0.7)"></div>`,
  className: "",
  iconAnchor: [8, 8],
});

// Live rescue-team marker (victim tracking view). Distinct from the small
// red "rescueIcon" dot above, which marks the *victim* on the rescue team's map.
const teamIcon = divIcon({
  html: `<div style="background:#ef4444;width:30px;height:30px;border-radius:50%;border:2px solid white;box-shadow:0 0 14px rgba(239,68,68,0.8);display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1">🚑</div>`,
  className: "",
  iconAnchor: [15, 15],
});

// Auto-fit bounds
function FitBounds({ coords }) {
  const map = useMap();
  // Keyed on the content (ends + length), not array identity: callers that
  // re-render often (e.g. the live tracker's "updated Xs ago" clock) pass a
  // fresh array each time and must not keep resetting the user's pan/zoom.
  const first = coords?.[0];
  const last = coords?.[coords.length - 1];
  const key = coords?.length > 1 ? `${coords.length}|${first.lat},${first.lng}|${last.lat},${last.lng}` : "";
  useEffect(() => {
    if (coords && coords.length > 1) {
      const bounds = coords.map((c) => [c.lat, c.lng]);
      map.fitBounds(bounds, { padding: [40, 40] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export default function RouteMap({
  userLocation,
  targetLocation,
  route = [],
  targetLabel = "Shelter",
  mode = "shelter", // "shelter" | "rescue" | "track"
  // Optional live rescue-team position. Only the victim tracking view passes
  // this (mode="track": userLocation = victim, this = team); every other
  // caller is unaffected.
  rescueLocation = null,
  rescueLabel = "Rescue Team",
}) {
  const { boundary, center: regionCenter } = useRegion();
  const center = userLocation
    ? [userLocation.lat, userLocation.lng]
    : targetLocation
    ? [targetLocation.lat, targetLocation.lng]
    : regionCenter || CHANDIGARH_CENTER;

  const routeCoords = route.map((p) => [p.lat, p.lng]);
  const lineColor = mode === "rescue" || mode === "track" ? "#ef4444" : "#3b82f6";
  const dashed = mode === "rescue" || mode === "track";

  return (
    <div className="map-container h-full w-full">
      <MapContainer
        center={center}
        zoom={CHANDIGARH_CITY_ZOOM}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
        className="h-full w-full"
      >
        <ZoomControl position="bottomright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`}
          subdomains="abcd"
        />

        {boundary && (
          <GeoJSON
            data={boundary}
            style={{ color: "#38bdf8", weight: 2, dashArray: "6 4", fillOpacity: 0.03 }}
          />
        )}

        {route.length > 1 && <FitBounds coords={route} />}
        {route.length <= 1 && rescueLocation && userLocation && (
          <FitBounds coords={[userLocation, rescueLocation]} />
        )}

        {/* Route line */}
        {routeCoords.length > 1 && (
          <>
            {/* Glow effect */}
            <Polyline
              positions={routeCoords}
              pathOptions={{ color: lineColor, weight: 10, opacity: 0.15 }}
            />
            <Polyline
              positions={routeCoords}
              pathOptions={{
                color: lineColor,
                weight: 3,
                opacity: 0.9,
                dashArray: dashed ? "8, 8" : undefined,
              }}
            />
          </>
        )}

        {/* User position */}
        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
            <Popup>📍 Your Location</Popup>
          </Marker>
        )}

        {/* Live rescue team (victim tracking view) */}
        {rescueLocation && (
          <Marker position={[rescueLocation.lat, rescueLocation.lng]} icon={teamIcon} zIndexOffset={1000}>
            <Popup>🚑 {rescueLabel}</Popup>
          </Marker>
        )}

        {/* Target (shelter or victim) */}
        {targetLocation && (
          <Marker
            position={[targetLocation.lat, targetLocation.lng]}
            icon={mode === "rescue" ? rescueIcon : shelterIcon}
          >
            <Popup>{mode === "rescue" ? "🚨 Rescue Target" : `🏠 ${targetLabel}`}</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
