import { AxeBuilder } from "@axe-core/playwright";

import { test, expect } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";

test("auth, family review and roster overlays have accessible names, contrast and keyboard focus", async ({
  page,
  isMobile,
}) => {
  await page.goto("/signup");
  const audit = async () => {
    const builder = new AxeBuilder({ page });
    if (isMobile) {
      // Base UI deliberately exposes these non-actionable sentinels to VoiceOver.
      // Upstream classifies this as expected: https://github.com/mui/base-ui/issues/5237
      // Keep all rules enabled for app controls; keyboard trapping is tested below.
      builder.exclude(
        'span[data-base-ui-focus-guard][data-type="inside"][role="button"]'
      );
    }
    const result = await builder
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  };
  await expect(page.getByLabel("Email", { exact: true })).toBeEnabled();
  await audit();
  await page
    .getByRole("button", { exact: true, name: "Create account" })
    .click();
  await expect(page.getByLabel("Your name", { exact: true })).toBeFocused();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter your name." })
  ).toBeVisible();
  await audit();
  await new AuthPage(page).signUp(
    "Accessible organizer",
    `access-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("Accessible family");
  await family.addAdult("Robin");
  await audit();
  await family.openRename("Robin");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute(
    "data-slot",
    isMobile ? "drawer-popup" : "dialog-content"
  );
  await audit();
  await dialog.getByLabel("Name", { exact: true }).fill("Unsaved edit");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { exact: true, name: "Manage Robin" })
  ).toBeFocused();
  await family.openRename("Robin");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Robin");
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await family.saveRename("Robin saved");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { exact: true, name: "Manage Robin saved" })
  ).toBeFocused();
  await audit();
});
