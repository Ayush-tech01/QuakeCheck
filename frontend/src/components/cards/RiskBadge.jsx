import { RISK_LEVELS } from "../../utils/earthquakeRisk";

/**
 * "QuakeCheck Risk" level badge. LOW / MODERATE stay subtle; HIGH is bolder
 * and CRITICAL gets a thin ring (no animation).
 */
export default function RiskBadge({ level }) {
  const cfg = RISK_LEVELS[level];
  if (!cfg) return null;
  const emphasis =
    level === "CRITICAL" ? "font-bold ring-1 ring-danger-400/60" :
    level === "HIGH" ? "font-semibold" : "";
  return <span className={`badge ${cfg.badgeClass} ${emphasis}`}>{cfg.label}</span>;
}
