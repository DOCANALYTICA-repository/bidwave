/**
 * Static, brochure-derived copy for the six Bidwave rounds — the
 * always-public overview (PUB-02). Deliberately independent of the
 * `rounds` DB table: that table holds the admin's authenticated,
 * in-progress working draft (brief/materials/timing) which must never leak
 * to an anonymous visitor before release (§6.1). `slug` here is the join
 * key to a real `rounds` row once one exists, but every field below
 * renders correctly with no DB row at all.
 */
export type RoundSlug =
  | "the-stat-sprint"
  | "operation-fan-heist"
  | "the-immersive-challenge"
  | "crisis-room"
  | "the-grand-auction"
  | "the-owners-summit";

export type RoundCopy = {
  sequence: number;
  slug: RoundSlug;
  name: string;
  tagline: string;
  summary: string;
  dayLabel: string;
};

export const ROUND_COPY: Record<RoundSlug, RoundCopy> = {
  "the-stat-sprint": {
    sequence: 1,
    slug: "the-stat-sprint",
    name: "The Stat Sprint",
    tagline: "Every question brings you one step closer to the auction floor.",
    summary:
      "A fast-paced IPL quiz testing cricketing knowledge, analytical thinking and composure under pressure — player statistics, historic milestones, iconic moments and franchise records. The curtain-raiser that determines who advances.",
    dayLabel: "Online · dates announced separately",
  },
  "operation-fan-heist": {
    sequence: 2,
    slug: "operation-fan-heist",
    name: "Operation Fan Heist",
    tagline: "Winning matches earns trophies. Winning hearts builds legacies.",
    summary:
      "An immersive marketing simulation: step into the role of senior franchise executives and solve one of the toughest branding challenges in modern sport, combining creativity, consumer psychology, strategic planning and business acumen.",
    dayLabel: "Online · dates announced separately",
  },
  "the-immersive-challenge": {
    sequence: 3,
    slug: "the-immersive-challenge",
    name: "The Immersive Challenge",
    tagline: "When the game comes alive around you.",
    summary:
      "Bidwave's most mysterious round — cutting-edge virtual reality blended with interactive gameplay, transporting participants into a new environment where every observation and decision matters.",
    dayLabel: "Day 1 · 17 August 2026",
  },
  "crisis-room": {
    sequence: 4,
    slug: "crisis-room",
    name: "Crisis Room",
    tagline: "Every decision is questioned. Every answer is challenged.",
    summary:
      "A group discussion round: dynamic conversations centered on cricket, sports management, business and current affairs across the IPL ecosystem.",
    dayLabel: "Day 1 · 17 August 2026",
  },
  "the-grand-auction": {
    sequence: 5,
    slug: "the-grand-auction",
    name: "The Grand Auction",
    tagline: "Build wisely. Bid boldly.",
    summary:
      "The heart of Bidwave — strategy meets instinct in an intense battle to assemble the ultimate squad from a dynamic pool of uncapped prospects, emerging talents and established stars. Every bid carries significant consequences.",
    dayLabel: "Day 2 · 18–19 August 2026",
  },
  "the-owners-summit": {
    sequence: 6,
    slug: "the-owners-summit",
    name: "The Owners' Summit",
    tagline: "The auction may be over, but the spotlight has just begun.",
    summary:
      "Franchise owners take center stage before a live audience to justify the vision behind their auction strategy, player selections and franchise planning.",
    dayLabel: "Day 3 · 19 August 2026 (afternoon)",
  },
};

export const ROUND_COPY_LIST: RoundCopy[] = Object.values(ROUND_COPY).sort(
  (a, b) => a.sequence - b.sequence,
);
