import { describe, expect, it } from "vitest";
import { parseSharedLink } from "@/lib/validation/shared-link";

describe("parseSharedLink", () => {
  it("accepts a Drive sharing link and strips the fragment", () => {
    const r = parseSharedLink(" https://drive.google.com/file/d/abc123/view?usp=sharing#x ");
    expect(r).toEqual({ ok: true, url: "https://drive.google.com/file/d/abc123/view?usp=sharing" });
  });
  it("accepts youtu.be", () => {
    expect(parseSharedLink("https://youtu.be/abc").ok).toBe(true);
  });
  it("rejects http", () => {
    expect(parseSharedLink("http://drive.google.com/x")).toMatchObject({ ok: false });
  });
  it("rejects an unknown host", () => {
    expect(parseSharedLink("https://evil.example.com/x")).toMatchObject({ ok: false });
  });
  it("rejects prose", () => {
    expect(parseSharedLink("here is my video")).toMatchObject({ ok: false });
  });
  it("rejects empty", () => {
    expect(parseSharedLink("   ")).toMatchObject({ ok: false });
  });
  it("strips embedded credentials", () => {
    const r = parseSharedLink("https://u:p@drive.google.com/file/d/a/view");
    expect(r.ok && r.url).toBe("https://drive.google.com/file/d/a/view");
  });
});
