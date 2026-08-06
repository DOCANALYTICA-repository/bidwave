const GUIDELINES = [
  "Teams of 3 (plus an optional 4th member) — all students of CHRIST University, Bangalore.",
  "Each team registers once and competes together through every round.",
  "One round is open at a time — the next round is released only after the current one closes and scoring is complete.",
  "The live auction (Round 5) is conducted physically — bids are recorded by the admin, never placed through the website.",
  "Final rankings combine every round's results per an admin-confirmed, published policy.",
];

/** PUB-08: static, hardcoded per the brochure/PRD — general event guidelines don't need admin edits. */
export function GuidelinesSection() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-12">
      <h2 className="mb-4 text-center font-heading text-xs font-semibold uppercase tracking-widest text-gold">
        General Guidelines
      </h2>
      <ul className="space-y-2">
        {GUIDELINES.map((g) => (
          <li key={g} className="flex gap-3 text-sm text-ink-2">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
            {g}
          </li>
        ))}
      </ul>
    </section>
  );
}
