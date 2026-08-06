import { test, expect, type Page } from "@playwright/test";

/**
 * Server-side uniqueness rejection via register_team() (see the
 * migration's `unique_violation` handling, surfaced through
 * src/lib/validation/registration.ts's parseRpcErrorCode/
 * REGISTRATION_ERROR_FIELD). Both scenarios below collide with the
 * seeded "Franchise Alpha" fixture (tests/e2e/fixtures.ts / scripts/
 * seed-demo.cjs) while keeping every *other* field fresh, so the wizard's
 * client-side Zod schema (src/lib/validation/registration.ts) passes and
 * the request actually reaches the RPC — a client-side rejection would
 * never exercise the server error path this test targets.
 *
 * Note: the seeded teams' own emails (`*@test.bidwave.local`) don't end in
 * `.christuniversity.in`, so they fail christEmailSchema client-side and
 * can't be used to reproduce a duplicate_email server rejection through
 * the real UI — only team-name and register-number collisions are
 * reachable this way, which is why those are the two cases covered here.
 */

const stamp = Date.now();
const dummyPdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

async function fillStep0(page: Page, teamName: string) {
  await page.getByLabel("Team name").fill(teamName);
  await page.getByLabel("Campus").click();
  await page.getByRole("option", { name: "Bangalore" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

type Member = { fullName: string; className: string; registerNumber: string; phone: string; christEmail: string };

async function fillStep1(page: Page, members: Member[]) {
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    await page.getByLabel("Full name").nth(i).fill(m.fullName);
    await page.getByLabel("Class").nth(i).fill(m.className);
    await page.getByLabel("Register number").nth(i).fill(m.registerNumber);
    await page.getByLabel("Phone number").nth(i).fill(m.phone);
    await page.getByLabel("CHRIST email").nth(i).fill(m.christEmail);
  }
  await page.getByRole("button", { name: "Set as captain" }).first().click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

async function fillStep2ThroughSubmit(page: Page) {
  await page.getByLabel("Password").fill("SuperSecret!1");
  await page.getByLabel("Confirm password").fill("SuperSecret!1");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.locator('input[type="file"]').setInputFiles({
    name: "invoice.pdf",
    mimeType: "application/pdf",
    buffer: dummyPdf,
  });
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.getByRole("button", { name: "Complete registration" }).click();
}

test.describe("registration server-side uniqueness rejection", () => {
  test("duplicate team name is rejected with the exact server error, on the team-identity step", async ({ page }) => {
    await page.goto("/register");

    // "Franchise Alpha" collides with the seeded fixture team.
    await fillStep0(page, "Franchise Alpha");
    await fillStep1(page, [
      {
        fullName: "Dup Name Test One",
        className: "I BCom A",
        registerNumber: `E2EVAL${stamp}A`,
        phone: "9876500001",
        christEmail: `dupname1.${stamp}@btech.christuniversity.in`,
      },
      {
        fullName: "Dup Name Test Two",
        className: "I BCom A",
        registerNumber: `E2EVAL${stamp}B`,
        phone: "9876500002",
        christEmail: `dupname2.${stamp}@btech.christuniversity.in`,
      },
      {
        fullName: "Dup Name Test Three",
        className: "I BCom B",
        registerNumber: `E2EVAL${stamp}C`,
        phone: "9876500003",
        christEmail: `dupname3.${stamp}@btech.christuniversity.in`,
      },
    ]);
    await fillStep2ThroughSubmit(page);

    // ERR-01: the wizard jumps back to whichever step owns the rejected
    // field — duplicate_team_name maps to "teamName" (step 0).
    await expect(page.getByRole("heading", { name: "Register your team" })).toBeVisible();
    await expect(page.getByText('Team name "Franchise Alpha" is already registered.')).toBeVisible();
    await expect(page.getByText("Registration failed. Please check the highlighted fields.")).toBeVisible();
    // Still on /register — no client-side navigation happened.
    await expect(page).toHaveURL(/\/register$/);
  });

  test("duplicate register number is rejected with the exact server error, on the members step", async ({ page }) => {
    await page.goto("/register");

    await fillStep0(page, `E2E Validation Team ${stamp}`);
    await fillStep1(page, [
      {
        fullName: "Dup Regno Test One",
        className: "I BCom A",
        // Collides with Franchise Alpha's seeded member 0
        // (`DEMO${String(teamIndex).padStart(2, "0")}${i}` — scripts/seed-demo.cjs).
        registerNumber: "DEMO000",
        phone: "9876500011",
        christEmail: `dupregno1.${stamp}@btech.christuniversity.in`,
      },
      {
        fullName: "Dup Regno Test Two",
        className: "I BCom A",
        registerNumber: `E2EVAL2${stamp}B`,
        phone: "9876500012",
        christEmail: `dupregno2.${stamp}@btech.christuniversity.in`,
      },
      {
        fullName: "Dup Regno Test Three",
        className: "I BCom B",
        registerNumber: `E2EVAL2${stamp}C`,
        phone: "9876500013",
        christEmail: `dupregno3.${stamp}@btech.christuniversity.in`,
      },
    ]);
    await fillStep2ThroughSubmit(page);

    // duplicate_register_number maps to the "members" field (step 1).
    await expect(page.getByText("Team members")).toBeVisible();
    await expect(
      page.getByText("One of the register numbers is already registered for this edition."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });
});
