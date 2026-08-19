import { describe, expect, it } from "vitest";
import {
  CRORE,
  croreToRupees,
  formatCrore,
  formatRupees,
  parseCroreInput,
  rupeesToCroreInput,
} from "@/lib/auction/format";

describe("formatCrore", () => {
  it("renders rupees as compact crore, dropping trailing zeros", () => {
    expect(formatCrore(915_000_000)).toBe("₹91.5cr");
    expect(formatCrore(20_000_000)).toBe("₹2cr");
    expect(formatCrore(0)).toBe("₹0cr");
  });
});

describe("croreToRupees", () => {
  it("converts the amounts the console actually sees", () => {
    expect(croreToRupees(5.5)).toBe(55_000_000);
    expect(croreToRupees(0.2)).toBe(2_000_000);
    expect(croreToRupees(1)).toBe(CRORE);
  });

  it("rounds to whole rupees rather than carrying float drift", () => {
    // 1.1 * 10^7 is 11000000.000000002 in binary floating point, and
    // record_sale's numeric(14,2) column would store the drift.
    expect(croreToRupees(1.1)).toBe(11_000_000);
    expect(Number.isInteger(croreToRupees(0.07))).toBe(true);
  });
});

describe("rupeesToCroreInput", () => {
  it("prefills ordinary base prices as short, readable numbers", () => {
    expect(rupeesToCroreInput(55_000_000)).toBe("5.5");
    expect(rupeesToCroreInput(2_000_000)).toBe("0.2");
    expect(rupeesToCroreInput(20_000_000)).toBe("2");
  });

  it("never floors a small non-zero amount to '0'", () => {
    // A "0" prefill submits as zero, which record_sale rejects on
    // auction_sales_amount_check — the field must stay round-trippable at
    // whole-rupee resolution.
    expect(rupeesToCroreInput(1_000)).not.toBe("0");
    expect(croreToRupees(Number(rupeesToCroreInput(1_000)))).toBe(1_000);
    expect(croreToRupees(Number(rupeesToCroreInput(1)))).toBe(1);
    expect(rupeesToCroreInput(0)).toBe("0");
  });
});

describe("parseCroreInput", () => {
  it("accepts what the admin types into the crore field", () => {
    expect(parseCroreInput("5.5")).toBe(55_000_000);
    expect(parseCroreInput(" 0.2 ")).toBe(2_000_000);
    expect(parseCroreInput("12")).toBe(120_000_000);
    expect(parseCroreInput("1,5")).toBe(150_000_000); // stray thousands comma
  });

  it("refuses anything that is not a plain non-negative number", () => {
    // The unit is printed in the field, so typing it is the likely slip.
    expect(parseCroreInput("5.5 Cr")).toBeNull();
    expect(parseCroreInput("5.5cr")).toBeNull();
    expect(parseCroreInput("")).toBeNull();
    expect(parseCroreInput("-1")).toBeNull();
    expect(parseCroreInput("abc")).toBeNull();
  });
});

describe("formatRupees", () => {
  it("prints Indian digit grouping, matching the <Money> component", () => {
    expect(formatRupees(1_250_000_000)).toBe("₹1,25,00,00,000");
    expect(formatRupees(2_000_000)).toBe("₹20,00,000");
  });
});
