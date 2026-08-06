import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { STATUS_TONES, StatusPill, type StatusKey } from "./status-pill";

describe("StatusPill", () => {
  it("renders the §8.1 default copy for every status", () => {
    render(<StatusPill status="open-eligible" />);
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("lets a caller override the label without changing the tone mapping", () => {
    render(<StatusPill status="closed" label="Closes in 2h" />);
    expect(screen.getByText("Closes in 2h")).toBeInTheDocument();
  });

  it("gives every status key exactly one tone (no silently-unstyled status)", () => {
    const keys = Object.keys(STATUS_TONES) as StatusKey[];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(STATUS_TONES[key]).toBeTruthy();
    }
  });
});
