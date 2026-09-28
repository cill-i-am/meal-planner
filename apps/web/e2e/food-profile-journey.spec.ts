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
