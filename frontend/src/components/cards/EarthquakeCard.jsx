import { motion } from "framer-motion";
import { MapPin, Clock, AlertTriangle, Waves } from "lucide-react";
import RiskBadge from "./RiskBadge";
import { assessQuake, formatKm, isElevated } from "../../utils/earthquakeRisk";

const MAG_CONFIG = [
  { max: 2.5,  label: "Minor",    cls: "badge-green" },
  { max: 4.0,  label: "Light",    cls: "badge-green" },
  { max: 5.0,  label: "Moderate", cls: "badge-yellow" },
  { max: 6.0,  label: "Strong",   cls: "badge-yellow" },
  { max: 7.0,  label: "Major",    cls: "badge-red" },
  { max: Infinity, label: "Great", cls: "badge-red" },
];

const ALERT_BADGE = {
  green:  { cls: "badge-green",  label: "Low" },
  yellow: { cls: "badge-yellow", label: "Moderate" },
  orange: { cls: "badge-red",    label: "High" },
  red:    { cls: "badge-red",    label: "Severe" },
};

function getMagConfig(mag) {
  // A missing magnitude must not be mislabelled "Minor".
  if (!Number.isFinite(mag)) return { label: "Unknown", cls: "badge-gray" };
  return MAG_CONFIG.find((c) => mag < c.max) || MAG_CONFIG[MAG_CONFIG.length - 1];
}

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function EarthquakeCard({ quake, index = 0 }) {
  const magConfig = getMagConfig(quake.magnitude);
  const alertConfig = quake.alert ? ALERT_BADGE[quake.alert] : null;
  // Third, separate signal (see utils/earthquakeRisk.js): regional relevance to Chandigarh.
  const risk = assessQuake(quake);
  const magColor =
    quake.magnitude >= 6 ? "text-danger-400" :
    quake.magnitude >= 4 ? "text-warning-400" :
    "text-safe-400";

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`glass border ${risk.assessed && isElevated(risk.level) ? "border-danger-500/40" : "border-white/10"} p-4 hover:bg-white/8 hover:border-electric-500/20 
                 transition-all duration-300 cursor-default group`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Magnitude */}
        <div className="flex-shrink-0 text-center">
          <div className={`text-3xl font-black leading-none ${magColor}`}>
            {Number.isFinite(quake.magnitude) ? quake.magnitude.toFixed(1) : "—"}
          </div>
          <div className={`badge mt-1 ${magConfig.cls}`}>{magConfig.label}</div>
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white leading-tight truncate group-hover:text-clip">
            {quake.place}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-white/40">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo(quake.time)}
            </span>
            {quake.depth && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {quake.depth}km depth
              </span>
            )}
            {quake.tsunami && (
              <span className="flex items-center gap-1 text-warning-400">
                <Waves className="h-3 w-3" /> Tsunami Warning
              </span>
            )}
          </div>

          {/* QuakeCheck Risk + distance (distance shown whenever coordinates are usable) */}
          {(risk.assessed || risk.distanceKm !== null) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-xs text-white/40">
              {risk.assessed && (
                <>
                  <span>QuakeCheck Risk:</span>
                  <RiskBadge level={risk.level} />
                  <span className="text-white/20">•</span>
                </>
              )}
              {risk.distanceKm !== null && <span>{formatKm(risk.distanceKm)} from Chandigarh</span>}
            </div>
          )}
        </div>

        {/* Alert */}
        {alertConfig && (
          <div className={`badge flex-shrink-0 ${alertConfig.cls}`}>
            <AlertTriangle className="h-3 w-3" />
            {alertConfig.label}
          </div>
        )}
      </div>
    </motion.div>
  );
}
