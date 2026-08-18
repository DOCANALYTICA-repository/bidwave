/**
 * Compact crore formatting for dense auction surfaces.
 *
 * The shared <Money> component prints full Indian digit grouping
 * (₹1,30,00,00,000), which is right for a table cell but far too wide for a
 * six-across board where every tile is ~150px. Crore is also how the room
 * actually talks about these numbers, so the compact form is the honest one
 * at that density rather than a lossy shortcut.
 */
const croreFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** 915000000 -> "₹91.5cr". Trailing zeros are dropped by the formatter. */
export function formatCrore(rupees: number): string {
  return `₹${croreFmt.format((Number(rupees) || 0) / 10_000_000)}cr`;
}
