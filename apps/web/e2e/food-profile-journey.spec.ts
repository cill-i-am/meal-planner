import {
  HouseholdPeopleRoster,
  PersonProfile,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { expect, test } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";
import { FoodProfilePage } from "./pages/food-profile-page.js";

test("a completed family can save and correct a visible food preference", async ({
  page,
}) => {
  await new AuthPage(page).signUp(
    "Profile organizer",
    `profile-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("Food profile family");
  const familyId = new URL(page.url()).searchParams.get("familyId");
  expect(familyId).toBeTruthy();
  await family.confirm();

  const profile = new FoodProfilePage(page);
  await profile.expectPerson("Profile organizer");
  await profile.expectVersion(0);
  await profile.addPreference("Peas");
  await profile.expectVersion(1);
  await page.reload();
  await profile.expectPreference("Peas");
  await profile.correctPreference("Peas", "Carrots");
  await profile.expectVersion(2);
  await page.reload();
  await profile.expectPreference("Carrots");
  await profile.expectVersion(2);

  const response = await page.request.get(`/v1/families/${familyId}/people`);
  expect(response.ok()).toBe(true);
  const roster = Schema.decodeUnknownSync(HouseholdPeopleRoster)(
    await response.json()
  );
  expect(roster.people).toHaveLength(1);
  const personId = roster.people[0]?.id;
  expect(personId).toBeDefined();
  const saved = await page.request.get(
    `/v1/families/${familyId}/people/${personId}/profile`
  );
  expect(saved.ok()).toBe(true);
  const current = Schema.decodeUnknownSync(PersonProfile)(await saved.json());
  expect(current.version).toBe(2);
  expect(current.facts).toHaveLength(1);
  expect(current.facts[0]?.value).toMatchObject({
    _tag: "FoodPreference",
    label: "Carrots",
  });
});

test("saved food facts stays reachable while the food conversation loads", async ({
  page,
}, testInfo) => {
  await new AuthPage(page).signUp(
    "Profile organizer",
    `profile-loading-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("Food profile family");
  await family.confirm();
  await expect(
    page.getByRole("heading", { name: "Find the food they say yes to." })
  ).toBeVisible();
  const hasTouch = testInfo.project.name === "mobile-webkit";
  if (hasTouch) {
    await page.setViewportSize({ height: 640, width: 320 });
  }

  const heldConversation = Promise.withResolvers<null>();
  const intercepted = Promise.withResolvers<null>();
  await page.route(
    /\/v1\/families\/[^/]+\/agent-conversation$/u,
    async (route) => {
      const response = await route.fetch();
      intercepted.resolve(null);
      await heldConversation.promise;
      await route.fulfill({ response });
    }
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await intercepted.promise;
  const summary = page.locator("#saved-food-facts > summary");
  await expect(page.getByText("Loading conversation…")).toBeVisible();
  await summary.scrollIntoViewIfNeeded();
  const before = await summary.boundingBox();
  if (before === null) {
    throw new Error("The saved-facts summary has no visible tap target.");
  }

  heldConversation.resolve(null);
  await expect(
    page.getByRole("heading", { name: "Let’s find a first yes." })
  ).toBeVisible();
  const x = before.x + before.width / 2;
  const y = before.y + before.height / 2;
  await (hasTouch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  await expect(
    page.getByRole("region", { name: "Food profiles" })
  ).toBeVisible();
  const firstQuestion = page.getByRole("button", {
    name: "Ask our first food question",
  });
  await firstQuestion.scrollIntoViewIfNeeded();
  await expect(firstQuestion).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Your message" })
  ).toBeVisible();
});
