import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

const sizeMap = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-10 w-10",
  xl: "h-16 w-16",
};

export default function Spinner({ size = "md", className = "" }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`flex items-center justify-center ${className}`}
    >
      <Loader2 className={`${sizeMap[size]} text-electric-400 animate-spin`} />
    </motion.div>
  );
}
