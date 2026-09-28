import {
  HouseholdPeopleRoster,
  PersonProfile,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { expect, test } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";
import { FoodProfilePage } from "./pages/food-profile-page.js";
import { PrivateReviewPage } from "./pages/private-review-page.js";

test("an adult confirms a correction in a fresh private review while the earlier session stays closed", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await new AuthPage(page).signUp(
    "Private reviewer",
    `private-review-${crypto.randomUUID()}@example.test`
  );
  const family = new FamilyPage(page);
  await family.create("Private review family");
  const familyId = new URL(page.url()).searchParams.get("familyId");
  expect(familyId).toBeTruthy();
  await family.confirm();
  const profile = new FoodProfilePage(page);
  await profile.expectVersion(0);
  const rosterResponse = await page.request.get(
    `/v1/families/${familyId}/people`
  );
  expect(rosterResponse.ok()).toBe(true);
  const roster = Schema.decodeUnknownSync(HouseholdPeopleRoster)(
    await rosterResponse.json()
  );
  const personId = roster.people[0]?.id;
  expect(personId).toBeDefined();
  const readProfile = async () => {
    const response = await page.request.get(
      `/v1/families/${familyId}/people/${personId}/profile`
    );
    expect(response.ok()).toBe(true);
    return Schema.decodeUnknownSync(PersonProfile)(await response.json());
  };

  const review = new PrivateReviewPage(page);
  await review.start();
  await review.sendMessage("I like tomatoes.");
  await review.expectProposal("Tomatoes");
  const proposedProfile = await readProfile();
  expect(proposedProfile.version).toBe(0);
  await review.correctProposal("Carrots");
  const correctedProfile = await readProfile();
  expect(correctedProfile.version).toBe(0);
  await review.confirmProposal();
  await profile.expectVersion(1);
  await profile.expectPreference("Carrots");
  const firstProfile = await readProfile();
  expect(firstProfile.facts).toHaveLength(1);
  const [firstFact] = firstProfile.facts;
  expect(firstFact?.value).toMatchObject({ label: "Carrots" });
  expect(firstFact?.standing).toMatchObject({ _tag: "confirmed" });
  expect(firstProfile.audit).toMatchObject({
    nextVersion: 1,
    previousVersion: 0,
    source: "interview",
  });
  await review.complete();
  await review.start();
  await review.expectCurrentFact("Carrots");
  await review.sendMessage("I prefer peas now.");
  await review.expectProposal("Peas");
  const proposedReplacementProfile = await readProfile();
  expect(proposedReplacementProfile.version).toBe(1);
  await review.confirmProposal();
  await profile.expectVersion(2);
  await profile.expectPreference("Peas");
  const secondProfile = await readProfile();
  expect(secondProfile.facts).toHaveLength(1);
  expect(secondProfile.facts[0]).toMatchObject({
    id: firstFact?.id,
    value: { label: "Peas" },
  });
  expect(secondProfile.audit).toMatchObject({
    nextVersion: 2,
    previousVersion: 1,
    source: "interview",
  });
  await review.select(1);
  await review.expectCompleted();

  await page.reload();
  await review.select(2);
  await review.expectOpen();
  await review.select(1);
  await review.expectCompleted();
  await profile.expectVersion(2);
  await profile.expectPreference("Peas");
});
