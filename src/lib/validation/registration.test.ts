import { describe, expect, it } from "vitest";
import {
  registrationDetailsSchema,
  membersArraySchema,
  parseRpcErrorCode,
} from "./registration";

const validMember = (overrides: Partial<Record<string, unknown>> = {}) => ({
  fullName: "Jane Doe",
  className: "BCom 3",
  registerNumber: "23COM001",
  phone: "9876543210",
  christEmail: "jane.doe@btech.christuniversity.in",
  isCaptain: false,
  ...overrides,
});

const validMembers = () => [
  validMember({ isCaptain: true, registerNumber: "23COM001", christEmail: "a@btech.christuniversity.in" }),
  validMember({ registerNumber: "23COM002", christEmail: "b@btech.christuniversity.in" }),
  validMember({ registerNumber: "23COM003", christEmail: "c@btech.christuniversity.in" }),
];

describe("membersArraySchema", () => {
  it("accepts exactly 3 members with one captain (AT-REG-01)", () => {
    expect(membersArraySchema.safeParse(validMembers()).success).toBe(true);
  });

  it("accepts an optional 4th member (AT-REG-02)", () => {
    const members = [...validMembers(), validMember({ registerNumber: "23COM004", christEmail: "d@btech.christuniversity.in" })];
    expect(membersArraySchema.safeParse(members).success).toBe(true);
  });

  it("rejects fewer than 3 members (REG-02)", () => {
    const result = membersArraySchema.safeParse(validMembers().slice(0, 2));
    expect(result.success).toBe(false);
  });

  it("rejects more than 4 members", () => {
    const members = [
      ...validMembers(),
      validMember({ registerNumber: "23COM004", christEmail: "d@btech.christuniversity.in" }),
      validMember({ registerNumber: "23COM005", christEmail: "e@btech.christuniversity.in" }),
    ];
    expect(membersArraySchema.safeParse(members).success).toBe(false);
  });

  it("rejects zero captains (REG-04)", () => {
    const members = validMembers().map((m) => ({ ...m, isCaptain: false }));
    expect(membersArraySchema.safeParse(members).success).toBe(false);
  });

  it("rejects more than one captain (REG-04)", () => {
    const members = validMembers().map((m) => ({ ...m, isCaptain: true }));
    expect(membersArraySchema.safeParse(members).success).toBe(false);
  });

  it("rejects duplicate emails within the submitted set", () => {
    const members = validMembers();
    members[1] = { ...members[1], christEmail: members[0].christEmail };
    expect(membersArraySchema.safeParse(members).success).toBe(false);
  });

  it("rejects duplicate register numbers within the submitted set", () => {
    const members = validMembers();
    members[1] = { ...members[1], registerNumber: members[0].registerNumber };
    expect(membersArraySchema.safeParse(members).success).toBe(false);
  });

  it("rejects a non-CHRIST email domain (REG-06)", () => {
    const members = validMembers();
    members[0] = { ...members[0], christEmail: "jane@gmail.com" };
    expect(membersArraySchema.safeParse(members).success).toBe(false);
  });
});

describe("registrationDetailsSchema", () => {
  const base = {
    teamName: "Royal Commerce Challengers",
    campus: "Bangalore" as const,
    members: validMembers(),
    captainPassword: "supersecret1",
    captainPasswordConfirm: "supersecret1",
  };

  it("accepts a fully valid submission", () => {
    expect(registrationDetailsSchema.safeParse(base).success).toBe(true);
  });

  it("rejects mismatched password confirmation", () => {
    const result = registrationDetailsSchema.safeParse({
      ...base,
      captainPasswordConfirm: "different",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password under 8 characters", () => {
    const result = registrationDetailsSchema.safeParse({
      ...base,
      captainPassword: "short",
      captainPasswordConfirm: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid campus", () => {
    const result = registrationDetailsSchema.safeParse({ ...base, campus: "Mumbai" });
    expect(result.success).toBe(false);
  });

  it("rejects a team name under 2 characters", () => {
    const result = registrationDetailsSchema.safeParse({ ...base, teamName: "A" });
    expect(result.success).toBe(false);
  });
});

describe("parseRpcErrorCode", () => {
  it("parses a bracketed error code and message", () => {
    expect(parseRpcErrorCode('[duplicate_team_name] Team name "X" is already registered.')).toEqual({
      code: "duplicate_team_name",
      message: 'Team name "X" is already registered.',
    });
  });

  it("returns null for a message with no bracketed code", () => {
    expect(parseRpcErrorCode("some unrelated Postgres error")).toBeNull();
  });
});
