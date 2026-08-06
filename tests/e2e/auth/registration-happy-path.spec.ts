import { test, expect } from "@playwright/test";
import { loginAs } from "../fixtures";

/**
 * Walks a brand-new team through the real /register wizard end-to-end —
 * team identity (incl. campus Select), 3 required members + captain,
 * captain credentials, invoice upload, review, submit — then follows
 * /register/success's "Log in to your dashboard" link into a real sign-in
 * and confirms the dashboard renders for the freshly created team.
 *
 * register_team() enforces team-name/register-number/email uniqueness
 * (see src/lib/validation/registration.ts's REGISTRATION_ERROR_FIELD and
 * the migration's `unique_violation` handling), so every identifying value
 * here is stamped with Date.now() to guarantee a fresh run never collides
 * with the seeded "Franchise *" fixtures or a previous run of this spec.
 */
test("a fresh team can register, then log in to its dashboard", async ({ page }) => {
  const stamp = Date.now();
  const teamName = `E2E Wizard Team ${stamp}`;
  const captainEmail = `captain.e2e.${stamp}@btech.christuniversity.in`;
  const captainPassword = "SuperSecret!1";

  const members = [
    {
      fullName: "Aria Sharma",
      className: "I BCom A",
      registerNumber: `E2E${stamp}A`,
      phone: "9876543210",
      christEmail: captainEmail,
    },
    {
      fullName: "Kabir Rao",
      className: "I BCom A",
      registerNumber: `E2E${stamp}B`,
      phone: "9876543211",
      christEmail: `member2.e2e.${stamp}@btech.christuniversity.in`,
    },
    {
      fullName: "Meera Iyer",
      className: "I BCom B",
      registerNumber: `E2E${stamp}C`,
      phone: "9876543212",
      christEmail: `member3.e2e.${stamp}@btech.christuniversity.in`,
    },
  ];

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Register your team" })).toBeVisible();

  // Step 1: team identity — team name + campus Select (Base UI, not a
  // native <select>: click the trigger, then click the rendered option).
  await page.getByLabel("Team name").fill(teamName);
  await page.getByLabel("Campus").click();
  await page.getByRole("option", { name: "Bangalore" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 2: members — the wizard starts with 3 empty rows already, fill
  // each by index (labels repeat once per row) and mark the first captain.
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

  // Step 3: captain credentials — the shared team login is the captain's
  // CHRIST email from the previous step (read-only here).
  await expect(page.getByText(captainEmail)).toBeVisible();
  await page.getByLabel("Password").fill(captainPassword);
  await page.getByLabel("Confirm password").fill(captainPassword);
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 4: invoice upload — a small dummy PDF, well under the 10MB cap
  // and matching the accepted "application/pdf" MIME type (REG-07).
  const dummyPdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  await page.locator('input[type="file"]').setInputFiles({
    name: "invoice.pdf",
    mimeType: "application/pdf",
    buffer: dummyPdf,
  });
  await expect(page.getByText("invoice.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 5: review + submit.
  await expect(page.getByText(teamName)).toBeVisible();
  await page.getByRole("button", { name: "Complete registration" }).click();

  await page.waitForURL(/\/register\/success/);
  await expect(page.getByRole("heading", { name: new RegExp(`You're in, ${teamName}`) })).toBeVisible();

  // C1: registration must not auto-sign-in — the captain has to explicitly
  // log in afterward. Follow the real link (extracting href first per the
  // "Link click can silently no-op under Playwright" pitfall) rather than
  // asserting on it blind.
  const loginLink = page.getByRole("link", { name: "Log in to your dashboard" });
  await expect(loginLink).toBeVisible();
  const href = await loginLink.getAttribute("href");
  expect(href).toBe("/login");

  await loginAs(page, captainEmail, captainPassword);
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole("heading", { name: teamName })).toBeVisible();
});
