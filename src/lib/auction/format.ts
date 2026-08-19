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

const rupeeFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/**
 * Full Indian digit grouping — ₹1,25,00,00,000. Same output as the <Money>
 * component, as a plain string, for the places that need the exact figure in a
 * `title` next to a rounded crore display.
 */
export function formatRupees(rupees: number): string {
  return rupeeFmt.format(Number(rupees) || 0);
}

/** 915000000 -> "₹91.5cr". Trailing zeros are dropped by the formatter. */
export function formatCrore(rupees: number): string {
  return `₹${croreFmt.format((Number(rupees) || 0) / 10_000_000)}cr`;
}

/** One crore, in rupees. The unit the auction room actually speaks in. */
export const CRORE = 10_000_000;

/**
 * Crore <-> rupee conversion for the console's amount field.
 *
 * The console stopped asking for rupees (AUC-10 amounts are stored and
 * enforced in rupees, but nobody in the room says "fifty-five million") — the
 * field now takes "5.5" against a fixed `Cr` suffix. At ~40s per lot in the
 * cheap pools, typing three characters instead of eight is the difference
 * between keeping up and falling behind.
 *
 * Rounded to the nearest rupee: 0.2 * 10^7 is exact in binary floating point
 * but 1.1 * 10^7 is not (11000000.000000002), and record_sale's numeric(14,2)
 * column would happily store the drift.
 */
export function croreToRupees(crore: number): number {
  return Math.round(crore * CRORE);
}

/**
 * 55000000 -> "5.5", 2000000 -> "0.2". Bare digits, no unit and no symbol:
 * this is what goes *into* the input, next to its fixed `Cr` suffix.
 *
 * Seven decimals, because one crore is 10^7 rupees — that is exactly the
 * resolution at which every whole-rupee amount round-trips, and Number()
 * then drops the trailing zeros so ordinary prices still read as "5.5" and
 * "0.2". Rounding to two decimals instead (the obvious choice, since no real
 * base price is finer than a lakh) silently floored anything under ₹50,000 to
 * "0" — which record_sale rejects on `auction_sales_amount_check`, several
 * hundred milliseconds later and with a constraint name for a message.
 */
export function rupeesToCroreInput(rupees: number): string {
  const crore = (Number(rupees) || 0) / CRORE;
  return String(Number(crore.toFixed(7)));
}

/**
 * Parses what the admin typed in the crore field. Returns null for anything
 * that is not a non-negative finite number, so the caller can refuse to submit
 * rather than sending NaN (which record_sale would reject as a null amount,
 * several hundred milliseconds later and with a far less obvious message).
 */
export function parseCroreInput(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed === "") return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  const crore = Number(trimmed);
  if (!Number.isFinite(crore) || crore < 0) return null;
  return croreToRupees(crore);
}
