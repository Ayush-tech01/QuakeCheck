import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function StatCard({ icon: Icon, label, value, sub, trend, color = "blue" }) {
  const colors = {
    blue:   { bg: "bg-electric-500/10", text: "text-electric-400", border: "border-electric-500/20" },
    red:    { bg: "bg-danger-500/10",   text: "text-danger-400",   border: "border-danger-500/20"   },
    green:  { bg: "bg-safe-500/10",     text: "text-safe-400",     border: "border-safe-500/20"     },
    yellow: { bg: "bg-warning-500/10",  text: "text-warning-400",  border: "border-warning-500/20"  },
  };
  const c = colors[color] || colors.blue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className={`glass border ${c.border} p-6 hover:bg-white/8 transition-all duration-300`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 rounded-xl ${c.bg}`}>
          {Icon && <Icon className={`h-6 w-6 ${c.text}`} />}
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
            trend > 0 ? "bg-safe-500/10 text-safe-400" :
            trend < 0 ? "bg-danger-500/10 text-danger-400" :
            "bg-white/10 text-white/40"
          }`}>
            {trend > 0 ? <TrendingUp className="h-3 w-3" /> :
             trend < 0 ? <TrendingDown className="h-3 w-3" /> :
             <Minus className="h-3 w-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <p className="text-3xl font-bold text-white mb-1">{value}</p>
      <p className="text-sm font-medium text-white/70">{label}</p>
      {sub && <p className="text-xs text-white/40 mt-1">{sub}</p>}
    </motion.div>
  );
}
