"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";

/**
 * No route-level transition existed anywhere — `motion` was only ever used
 * for local UI (reconnect-banner, money ticks, hero). Wraps `children`
 * only, not the whole layout, so persistent chrome (SiteHeader/SiteFooter,
 * the admin sidebar, the app header) keeps NOT remounting between
 * navigations — that persistence is deliberate (see (public)/layout.tsx).
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <>{children}</>;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
