"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { BrandMark } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { BrochureDownloadLink } from "@/components/marketing/brochure-download-link";
import { cn } from "@/lib/utils";

export function Hero({
  dashboardHref,
}: {
  /** "/app" or "/admin" if a session exists, else undefined — the primary CTA changes accordingly. */
  dashboardHref?: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  const initial = prefersReducedMotion ? {} : { opacity: 0, y: 16 };
  const animate = prefersReducedMotion ? {} : { opacity: 1, y: 0 };

  return (
    <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center sm:py-28">
      <motion.div initial={initial} animate={animate} transition={{ duration: 0.5 }}>
        <BrandMark name="bidwave" height={96} priority />
      </motion.div>
      <motion.div
        initial={initial}
        animate={animate}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="space-y-3"
      >
        <h1 className="font-display text-4xl sm:text-5xl">The Pulse of IPL Auction</h1>
        <p
          className={cn(
            "font-heading text-sm uppercase tracking-widest text-gold",
            !prefersReducedMotion && "animate-pulse",
          )}
        >
          Think Fast. Bid Smart. Build Champions.
        </p>
        <p className="text-ink-2">
          17–19 August 2026 · Department of Commerce, CHRIST University
        </p>
      </motion.div>
      <motion.div
        initial={initial}
        animate={animate}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="flex flex-wrap items-center justify-center gap-4"
      >
        <Button size="lg" render={<Link href={dashboardHref ?? "/register"} />}>
          {dashboardHref ? "Go to your dashboard" : "Register your team"}
        </Button>
        <BrochureDownloadLink />
      </motion.div>
    </section>
  );
}
