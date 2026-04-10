import { motion as Motion } from "framer-motion";

export default function PageTransition({ children }) {
  return (
    <Motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.25 }}
      className="w-full h-full"
    >
      {children}
    </Motion.div>
  );
}
