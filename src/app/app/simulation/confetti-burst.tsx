"use client";

import { useState, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";

type Piece = { id: number; left: number; delay: number; duration: number; rotate: number; drift: number; color: string };

/**
 * No confetti dependency — this repo hand-rolls its visuals on principle
 * (see meter-bar.tsx), and this fires once per winning submission, not
 * often enough to justify a new dep + its own reduced-motion handling.
 * Only ever mounted after a successful submit (simulation-console.tsx).
 *
 * Math.random() must run inside an effect, never during render
 * (react-hooks/purity — same pattern as countdown.tsx) — an empty array on
 * the first render is fine here, since this component never exists in the
 * server-rendered tree in the first place.
 */
export function ConfettiBurst() {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [pieces, setPieces] = useState<Piece[]>([]);

  useEffect(() => {
    // One-shot randomized initialization, not a sync with external state —
    // same legitimate exception the set-state-in-effect rule's own
    // guidance carves out for "compute once on mount" (see
    // page-transition.tsx's mounted-flag comment for the analogous case).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPieces(
      Array.from({ length: 44 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.3,
        duration: 1.6 + Math.random() * 0.8,
        rotate: Math.random() * 360,
        drift: (Math.random() - 0.5) * 120,
        color: ["bg-gold", "bg-gold-bright", "bg-sold"][i % 3],
      })),
    );
    const id = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(id);
  }, []);

  if (reduceMotion || !visible) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className={`absolute h-2.5 w-1.5 ${p.color}`}
          style={{ left: `${p.left}%`, top: 0 }}
          initial={{ y: 0, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: 420, x: p.drift, rotate: p.rotate, opacity: 0 }}
          transition={{ duration: p.duration, delay: p.delay, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}
