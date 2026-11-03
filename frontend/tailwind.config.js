/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#040810",
          900: "#0a0f1e",
          800: "#0d1528",
          700: "#111c35",
          600: "#162240",
        },
        electric: {
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
        },
        danger: {
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
        },
        safe: {
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
        },
        warning: {
          400: "#facc15",
          500: "#eab308",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(59,130,246,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.05) 1px, transparent 1px)",
        "hero-gradient":
          "radial-gradient(ellipse at 20% 50%, rgba(59,130,246,0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(239,68,68,0.1) 0%, transparent 50%), linear-gradient(135deg, #040810 0%, #0a0f1e 100%)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "float": "float 6s ease-in-out infinite",
        "glow": "glow 2s ease-in-out infinite alternate",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        glow: {
          "0%": { boxShadow: "0 0 5px rgba(59,130,246,0.3)" },
          "100%": { boxShadow: "0 0 20px rgba(59,130,246,0.7)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
