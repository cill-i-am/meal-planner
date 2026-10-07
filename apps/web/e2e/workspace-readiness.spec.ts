import { expect, test } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";
import { FoodProfilePage } from "./pages/food-profile-page.js";
import { PrivateReviewPage } from "./pages/private-review-page.js";

test("food disclosures wait for the family roster before accepting clicks", async ({
  page,
}) => {
  await new AuthPage(page).signUp(
    "Food reviewer",
    `food-disclosures-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("Food review family");
  await family.confirm();
  await expect(
    page.getByRole("group", { name: "Choose a person" })
  ).toBeVisible();

  const rosterReady = Promise.withResolvers<null>();
  await page.route(
    (url) => /^\/v1\/families\/[^/]+\/people$/u.test(url.pathname),
    async (route) => {
      await rosterReady.promise;
      await route.continue();
    }
  );
  await page.reload({ waitUntil: "commit" });
  await expect(
    page.getByText("Loading your family…", { exact: true })
  ).toBeVisible();

  try {
    const clickWhileLoading = async (id: string) => {
      const disclosure = page.locator(`details#${id}`);
      const summary = disclosure.locator(":scope > summary");
      await summary.scrollIntoViewIfNeeded();
      const bounds = await summary.boundingBox();
      expect(bounds).not.toBeNull();
      if (bounds === null) {
        throw new Error("The disclosure summary is missing");
      }
      await page.mouse.click(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2
      );
      await expect(disclosure).not.toHaveAttribute("open", "");
    };
    await clickWhileLoading("private-food-conversations");
    await clickWhileLoading("saved-food-facts");
  } finally {
    rosterReady.resolve(null);
  }

  await expect(
    page.getByRole("group", { name: "Choose a person" })
  ).toBeVisible();
  await new PrivateReviewPage(page).open();
  await new FoodProfilePage(page).open();
});

test("sound changes wait for the workspace header and persist after reload", async ({
  page,
}) => {
  await new AuthPage(page).signUp(
    "Sound reviewer",
    `sound-readiness-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("Sound review family");
  await family.confirm();
  await page.goto("/?area=food");
  await expect(
    page.getByRole("heading", { exact: true, name: "Your food book." })
  ).toBeVisible();

  const familyReady = Promise.withResolvers<null>();
  await page.route(
    (url) => /^\/v1\/families\/[^/]+$/u.test(url.pathname),
    async (route) => {
      await familyReady.promise;
      await route.continue();
    }
  );

  try {
    await page.reload({ waitUntil: "commit" });
    await expect(
      page.getByRole("heading", { exact: true, name: "Loading your family…" })
    ).toBeVisible();
    const sound = page.getByRole("button", {
      exact: true,
      name: "Mute interaction sounds",
    });
    const bounds = await sound.boundingBox();
    if (bounds === null) {
      throw new Error("The sound control is missing");
    }
    await page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    );
    expect(
      await page.evaluate(() =>
        localStorage.getItem("meal-planner:interaction-sound")
      )
    ).toBeNull();
  } finally {
    familyReady.resolve(null);
  }

  await expect(
    page.getByRole("heading", { exact: true, name: "Your food book." })
  ).toBeVisible();
  await page
    .getByRole("button", { exact: true, name: "Mute interaction sounds" })
    .click();
  await expect(
    page.getByRole("button", { exact: true, name: "Enable interaction sounds" })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { exact: true, name: "Enable interaction sounds" })
  ).toBeVisible();
});
