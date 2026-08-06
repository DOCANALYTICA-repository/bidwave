"use client";

import { useEffect, useState } from "react";
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
  // `useReducedMotion()` reads matchMedia, which doesn't exist during SSR —
  // the server always renders the animated tree below, so honoring a
  // client-detected `reduceMotion === true` on the very first client render
  // (including hydration) renders a *different* tree shape than the server
  // sent, which React reports as a hydration mismatch (confirmed by direct
  // reproduction — every navigation on a `prefers-reduced-motion: reduce`
  // system threw "Hydration failed" and forced a full client-side
  // re-render). Gating on `mounted` keeps the first client render identical
  // to the server's, then applies the real preference immediately after.
  const [mounted, setMounted] = useState(false);
  // The standard hydration-safe "mounted" flag: this is the one legitimate
  // case for setState-in-effect the lint rule's own guidance carves out —
  // signaling "hydration is done, it's safe to diverge from the server's
  // tree now" cannot be expressed any other way.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (mounted && reduceMotion) return <>{children}</>;

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
