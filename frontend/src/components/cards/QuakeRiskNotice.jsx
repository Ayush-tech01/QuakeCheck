import { AlertTriangle } from "lucide-react";
import RiskBadge from "./RiskBadge";
import { formatKm } from "../../utils/earthquakeRisk";

/**
 * Compact contextual notice for HIGH / CRITICAL QuakeCheck Risk. Rendered only
 * when `items` (from getElevatedQuakes) is non-empty — nothing is shown
 * otherwise.
 *
 *  variant="compact" → dashboard alert next to the earthquake feed
 *  variant="safety"  → inside the existing safety screen, right above
 *                      I'm Safe / I Need Rescue
 *
 * It is information only: it never submits anything. An SOS is created solely
 * by the user pressing the existing "I Need Rescue" button.
 */
export default function QuakeRiskNotice({ items = [], variant = "compact" }) {
  if (!items.length) return null;

  const { quake, risk } = items[0];
  const more = items.length - 1;
  const critical = risk.level === "CRITICAL";
  const tone = critical
    ? { border: "border-danger-500/40", bg: "bg-danger-500/10", text: "text-danger-400" }
    : { border: "border-warning-500/30", bg: "bg-warning-500/5", text: "text-warning-400" };

  const summary = `M ${Number(quake.magnitude).toFixed(1)} • ${formatKm(risk.distanceKm)} ${variant === "safety" ? "from Chandigarh" : "away"}`;

  return (
    <div role="status" className={`glass border ${tone.border} ${tone.bg} rounded-xl px-4 py-3 flex items-start gap-3 text-left`}>
      <AlertTriangle className={`h-5 w-5 ${tone.text} mt-0.5 flex-shrink-0`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${tone.text}`}>
          {variant === "safety" ? "ELEVATED EARTHQUAKE RISK" : "Elevated Earthquake Risk"}
        </p>
        {variant === "compact" && (
          <p className="text-xs text-white/60 mt-0.5">
            A significant earthquake may be relevant to the Chandigarh region.
          </p>
        )}
        <p className="text-xs text-white/80 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{summary}</span>
          <span className="text-white/30">•</span>
          <span className="flex items-center gap-1.5">QuakeCheck Risk: <RiskBadge level={risk.level} /></span>
        </p>
        {more > 0 && (
          <p className="text-[11px] text-white/40 mt-1">
            +{more} more elevated-risk event{more > 1 ? "s" : ""} in the last 24 h
          </p>
        )}
        {variant === "safety" && (
          <>
            <p className="text-sm font-medium text-white mt-3">Are you safe?</p>
            <p className="text-xs text-white/50 mt-0.5">
              Choose I'm Safe or I Need Rescue below. QuakeCheck never sends an SOS for you — only you can.
            </p>
          </>
        )}
        <p className="text-[10px] text-white/25 mt-2">
          Regional risk assessment from magnitude, distance and depth — not an earthquake prediction.
        </p>
      </div>
    </div>
  );
}
