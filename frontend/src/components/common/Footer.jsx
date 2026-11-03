import { Link } from "react-router-dom";
import { Activity, Shield, Siren, Ambulance, ShieldAlert, Flame, HeartHandshake, Baby } from "lucide-react";

// Emergency contacts for the Chandigarh operational area.
// Source: Chandigarh Administration helpline page (https://chandigarh.gov.in/helpline).
// Keep numbers here only — the markup below renders them as tap-to-call tel: links.
const EMERGENCY_CONTACTS = [
  { icon: Siren,          name: "Integrated Emergency", numbers: ["112"],         desc: "National integrated emergency helpline", primary: true },
  { icon: Ambulance,      name: "Ambulance",            numbers: ["108"],         desc: "Emergency ambulance service" },
  { icon: ShieldAlert,    name: "Police",               numbers: ["100"],         desc: "Chandigarh Police emergency/control room" },
  { icon: Flame,          name: "Fire & Rescue",        numbers: ["101"],         desc: "Fire and rescue emergency service" },
  { icon: HeartHandshake, name: "Women Helpline",       numbers: ["1091", "181"], desc: "Women helpline" },
  { icon: Baby,           name: "Child Helpline",       numbers: ["1098"],        desc: "Child helpline" },
];

const headingCls = "text-xs font-semibold uppercase tracking-wider text-white/50 mb-4";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 mt-16">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-x-10 gap-y-8 mb-8">
          {/* Brand */}
          <div className="lg:col-span-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-5 w-5 text-electric-400" />
              <span className="font-bold text-lg">
                <span className="text-gradient">Quake</span>-Check
              </span>
            </div>
            <p className="text-white/40 text-sm leading-relaxed max-w-sm">
              Real-time earthquake monitoring & emergency response platform.
              Keeping communities safe through intelligent routing.
            </p>
          </div>

          {/* Platform */}
          <div className="lg:col-span-2">
            <h4 className={headingCls}>Platform</h4>
            <ul className="space-y-2.5 text-sm text-white/50">
              <li><Link to="/" className="hover:text-white transition-colors">Home</Link></li>
              <li><Link to="/emergency" className="hover:text-white transition-colors">Emergency</Link></li>
              <li><Link to="/register" className="hover:text-white transition-colors">Sign Up</Link></li>
            </ul>
          </div>

          {/* Emergency contacts */}
          <section aria-label="Emergency contacts" className="md:col-span-2 lg:col-span-6">
            <h4 className={headingCls}>Emergency Contacts</h4>
            <ul className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2.5">
              {EMERGENCY_CONTACTS.map(({ icon: Icon, name, numbers, desc, primary }) => (
                <li
                  key={name}
                  className={`rounded-lg border px-3.5 py-3 ${
                    primary ? "border-danger-500/30 bg-danger-500/[0.06]" : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-white/60">
                    <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${primary ? "text-danger-400" : "text-electric-400"}`} aria-hidden="true" />
                    <span>{name}</span>
                  </p>
                  <p className="mt-1.5 text-xl font-bold leading-none text-white tabular-nums">
                    {numbers.map((n, i) => (
                      <span key={n}>
                        {i > 0 && <span className="mx-1.5 font-normal text-white/30">/</span>}
                        <a href={`tel:${n}`} className="hover:text-electric-400 transition-colors">{n}</a>
                      </span>
                    ))}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-snug text-white/35">{desc}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-white/30 text-sm">
            © {new Date().getFullYear()} Quake-Check. Built for disaster response.
          </p>
          <div className="flex items-center gap-1 text-xs text-white/20">
            <Shield className="h-3 w-3" />
            <span>Chandigarh Disaster Response Platform</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
