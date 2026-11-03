import { MapContainer, TileLayer, Marker, Popup, Circle, ZoomControl, GeoJSON } from "react-leaflet";
import { Icon } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useRegion } from "../../hooks/useRegion";
import { CHANDIGARH_CENTER, CHANDIGARH_REGIONAL_ZOOM } from "../../config/region";
import RiskBadge from "../cards/RiskBadge";
import { assessQuake, formatKm, hasValidCoords } from "../../utils/earthquakeRisk";

const CARTO_API_KEY = import.meta.env.VITE_CARTO_API_KEY;

// Fix default icon path
delete Icon.Default.prototype._getIconUrl;
Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const MAG_COLOR = (mag) => {
  if (mag >= 7) return "#ef4444";
  if (mag >= 5) return "#f97316";
  if (mag >= 4) return "#eab308";
  return "#22c55e";
};

const BOUNDARY_STYLE = {
  color: "#38bdf8",
  weight: 2,
  dashArray: "6 4",
  fillColor: "#38bdf8",
  fillOpacity: 0.04,
};

// Global earthquake context still matters here (the app keeps monitoring
// worldwide USGS data per product decision), so this map defaults to a
// regional zoom centered on Chandigarh rather than a tight city-only view —
// close enough to anchor the app's home region, wide enough to see nearby
// seismic activity without having to pan out.
export default function QuakeMap({ earthquakes = [], shelters = [], center }) {
  const { boundary, center: regionCenter } = useRegion();
  const mapCenter = center || regionCenter || CHANDIGARH_CENTER;

  return (
    <div className="map-container h-full w-full">
      <MapContainer
        center={mapCenter}
        zoom={CHANDIGARH_REGIONAL_ZOOM}
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

        {/* Chandigarh operational boundary */}
        {boundary && <GeoJSON data={boundary} style={BOUNDARY_STYLE} />}

        {/* Earthquake circles */}
        {/* Events with no usable coordinates/magnitude can't be drawn — skip them rather than crash the map */}
        {earthquakes.filter((q) => hasValidCoords(q?.location?.lat, q?.location?.lng) && Number.isFinite(q.magnitude)).map((q) => {
          const risk = assessQuake(q); // same utility as EarthquakeCard
          return (
          <Circle
            key={q._id || q.eventId}
            center={[q.location.lat, q.location.lng]}
            radius={q.magnitude * 15000}
            pathOptions={{
              color: MAG_COLOR(q.magnitude),
              fillColor: MAG_COLOR(q.magnitude),
              fillOpacity: 0.25,
              weight: 1.5,
            }}
          >
            <Popup className="dark-popup">
              <div className="text-xs min-w-[160px]">
                <p className="font-bold text-base" style={{ color: MAG_COLOR(q.magnitude) }}>
                  M {q.magnitude.toFixed(1)}
                </p>
                <p className="mt-1 text-gray-300">{q.place}</p>
                {q.depth && <p className="text-gray-400">Depth: {q.depth} km</p>}
                <p className="text-gray-400">Distance from Chandigarh: {formatKm(risk.distanceKm)}</p>
                {risk.assessed && (
                  <p className="text-gray-400 mt-1 flex items-center gap-1.5">
                    QuakeCheck Risk: <RiskBadge level={risk.level} />
                  </p>
                )}
              </div>
            </Popup>
          </Circle>
          );
        })}

        {/* Shelter markers */}
        {shelters.map((s) => (
          <Marker key={s._id} position={[s.location.lat, s.location.lng]}>
            <Popup>
              <div className="text-xs min-w-[160px]">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">{s.name}</p>
                  {s.dataSource === "demo" && (
                    <span className="text-[9px] uppercase tracking-wide bg-yellow-500/20 text-yellow-600 px-1.5 py-0.5 rounded">
                      Demo data
                    </span>
                  )}
                </div>
                <p className="text-gray-400">Capacity: {s.currentOccupancy}/{s.capacity}</p>
                <p className="text-gray-400">Available: {s.capacity - s.currentOccupancy}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
