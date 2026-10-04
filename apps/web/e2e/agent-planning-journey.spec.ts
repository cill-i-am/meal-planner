import { Family } from "@meal-planner/families";
import {
  HouseholdMealPlanResponse,
  HouseholdPeopleRoster,
  MutatePersonProfilePayload,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";
import { RecipeId } from "@meal-planner/recipe-import-api";
import type { Page } from "@playwright/test";
import { Schema } from "effect";

import { expect, test } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";

const ask = async (page: Page, message: string) => {
  const conversation = page.getByRole("region", {
    exact: true,
    name: "Food conversation",
  });
  await conversation
    .getByRole("textbox", { exact: true, name: "Your message" })
    .fill(message);
  await conversation
    .getByRole("button", { exact: true, name: "Send message" })
    .click();
  return conversation;
};

const saveContent = async (page: Page, label: string) => {
  const response = page.waitForResponse(
    (item) =>
      item.url().endsWith("/v1/planning-content") &&
      item.request().method() === "POST"
  );
  await page.getByRole("button", { exact: true, name: label }).click();
  const saved = await response;
  expect(saved.ok(), await saved.text()).toBe(true);
  return Schema.decodeUnknownSync(PlanningContentSnapshot)(await saved.json());
};

test("reviews an assistant meal and a full two-week family plan, then changes one plate without changing the active plan", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await new AuthPage(page).signUp(
    "Alex",
    `planning-${crypto.randomUUID()}@example.test`
  );
  await page
    .getByRole("textbox", { exact: true, name: "Your message" })
    .fill("Set up my family");
  await page.getByRole("button", { exact: true, name: "Send message" }).click();
  await expect(
    page
      .getByRole("region", { name: "Your family table" })
      .getByRole("heading", { name: "The Test Table" })
  ).toBeVisible();
  await page
    .getByRole("textbox", { exact: true, name: "Your message" })
    .fill("Yes, everyone looks right.");
  await page.getByRole("button", { exact: true, name: "Send message" }).click();
  await expect(
    page.getByRole("heading", { name: "Find the food they say yes to." })
  ).toBeVisible();

  const familyResponse = await page.request.get("/v1/families");
  const [family] = Schema.decodeUnknownSync(Schema.NonEmptyArray(Family))(
    await familyResponse.json()
  );
  const rosterResponse = await page.request.get(
    `/v1/families/${family.id}/people`
  );
  const roster = Schema.decodeUnknownSync(HouseholdPeopleRoster)(
    await rosterResponse.json()
  );
  // This test starts from explicitly confirmed synthetic profiles. Discovery confirmation
  // and its persistence are covered by the separate native family journey.
  await Promise.all(
    roster.people.map(async (person) => {
      const response = await page.request.post(
        `/v1/families/${family.id}/people/${person.id}/profile`,
        {
          data: Schema.decodeUnknownSync(MutatePersonProfilePayload)({
            command: {
              _tag: "AddConfirmedProfileFact",
              basis: person.isCurrentAdult ? "self" : "household_adult",
              fact: { _tag: "NoKnownHardConstraints" },
            },
            expectedProfileVersion: 0,
            mutationId: crypto.randomUUID(),
          }),
        }
      );
      expect(response.ok(), await response.text()).toBe(true);
    })
  );

  await page.goto("/?area=food");
  const coverage = await saveContent(page, "Save managed meals");
  expect(coverage.managedOccasions).toHaveLength(8);
  expect(
    new Set(coverage.managedOccasions.map((entry) => entry.label))
  ).toEqual(new Set(["Breakfast", "Lunch", "Dinner", "Snacks"]));
  const conversation = await ask(page, "Add a meal option");
  await conversation
    .getByRole("button", { exact: true, name: "Review meal setup change" })
    .click();
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { exact: true, name: "Pasta night" })
  ).toBeVisible();
  await review
    .getByRole("button", { exact: true, name: "Save reviewed change" })
    .click();
  await expect(review).toBeHidden();
  await expect(
    page.getByRole("button", { name: /Pasta night/u }).first()
  ).toBeVisible();

  await page.getByLabel("Available equipment", { exact: true }).fill("hob");
  await saveContent(page, "Save cooking capacity");
  // These edits share one browser form and each save advances the content version.
  /* eslint-disable no-await-in-loop -- User interactions and versioned saves must run in sequence. */
  for (const occasion of coverage.managedOccasions) {
    await page
      .getByLabel("Person and meal", { exact: true })
      .selectOption(`${occasion.personId}:${occasion.occasionId}`);
    await page
      .getByLabel("Preparation window in minutes", { exact: true })
      .fill("30");
    await page
      .getByLabel("Can hands-off cooking start earlier?", { exact: true })
      .selectOption("available");
    await saveContent(page, "Save availability");
  }
  for (const person of roster.people) {
    await page
      .getByRole("button", { name: /Pasta night/u })
      .first()
      .click();
    await page
      .getByRole("button", { exact: true, name: "Review person suitability" })
      .click();
    const suitability = page.getByRole("dialog");
    await suitability
      .getByLabel("Person", { exact: true })
      .selectOption(person.id);
    await expect(
      suitability.getByText(/Current confirmed profile/u)
    ).toBeVisible();
    await suitability
      .getByRole("button", { exact: true, name: "Fits" })
      .click();
    await suitability
      .getByLabel("Why?", { exact: true })
      .fill("Reviewed the confirmed synthetic profile and this meal.");
    await suitability
      .getByRole("checkbox", { name: "I reviewed this food for this person." })
      .check();
    await saveContent(page, "Save person review");
    await expect(suitability).toBeHidden();
  }
  /* eslint-enable no-await-in-loop */

  await page.goto("/?area=weeks");
  await page
    .getByRole("button", { exact: true, name: "Create the first draft" })
    .click();
  await page.getByLabel("Start date", { exact: true }).fill("2026-09-28");
  await page.getByLabel("Weeks", { exact: true }).fill("2");
  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/meal-plans") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { exact: true, name: "Create draft" }).click();
  const createdResponse = await createResponse;
  expect(createdResponse.ok(), await createdResponse.text()).toBe(true);
  const created = Schema.decodeUnknownSync(HouseholdMealPlanResponse)(
    await createdResponse.json()
  );
  const planningConversation = await ask(page, "Plan a full week");
  await planningConversation
    .getByRole("button", { exact: true, name: "Review full plan change" })
    .click();
  await expect(
    page.getByRole("dialog").getByText("112 person meals", { exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { exact: true, name: "Use this proposal" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByRole("button", { exact: true, name: "Approve this plan" })
    .click();
  await expect(
    page.getByText("Approved family plan", { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Approved family plan", { exact: true })
  ).toBeVisible();
  const approvedResponse = await page.request.get(
    `/v1/meal-plans/${created.planId}`
  );
  const approved = Schema.decodeUnknownSync(HouseholdMealPlanResponse)(
    await approvedResponse.json()
  );
  expect(approved._tag).toBe("Approved");
  if (approved._tag !== "Approved") {
    throw new Error("The reviewed plan must be approved.");
  }
  expect(approved.active.coverage).toHaveLength(112);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("approved-weeks.png"),
  });
  expect(
    approved.active.coverage.filter(
      (entry) => entry.resolution._tag === "MealOption"
    )
  ).toHaveLength(108);
  expect(
    approved.active.coverage.filter(
      (entry) => entry.resolution._tag === "Prepared"
    )
  ).toHaveLength(4);
  expect(approved.active.cookEvents).toHaveLength(54);

  await page
    .getByRole("button", { exact: true, name: "Propose a change" })
    .click();
  await expect(
    page.getByText("Approved plan still active", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Day" }).click();
  await expect(
    page
      .getByRole("region", { name: /Monday.*28/u })
      .getByText("Dinner", { exact: true })
  ).toHaveCount(1);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("family-day.png"),
  });
  await page.getByRole("button", { name: /Wed.*30|30.*Wed/u }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Pasta night leftovers" })
  ).toBeVisible();
  await page.getByRole("button", { name: /Mon.*28|28.*Mon/u }).click();
  await page
    .getByRole("button", { exact: true, name: "Sam · change plate" })
    .first()
    .click();
  const change = page.getByRole("dialog");
  await change
    .getByRole("button", { exact: true, name: "Takeaway or out" })
    .click();
  await change
    .getByLabel("What happened?", { exact: true })
    .fill("Lunch out with family");
  await change
    .getByLabel("Why change it?", { exact: true })
    .fill("Plans changed for this meal.");
  await change
    .getByRole("button", { exact: true, name: "Review change" })
    .click();
  await expect(change).toBeHidden();
  const revisionResponse = await page.request.get(
    `/v1/meal-plans/${created.planId}`
  );
  const revision = Schema.decodeUnknownSync(HouseholdMealPlanResponse)(
    await revisionResponse.json()
  );
  expect(revision._tag).toBe("ProposedRevision");
  if (revision._tag !== "ProposedRevision") {
    throw new Error("A proposed revision must preserve its approved plan.");
  }
  expect(revision.active).toEqual(approved.active);
  expect(
    revision.proposed.coverage.filter(
      (entry) => entry.resolution._tag === "External"
    )
  ).toHaveLength(1);
  await page
    .getByRole("button", { exact: true, name: "Accept revision" })
    .click();
  await expect(
    page.getByText("Approved family plan", { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Approved family plan", { exact: true })
  ).toBeVisible();
});

test("opens a canonical saved recipe and follows cooking steps with sound muted and reduced motion", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await new AuthPage(page).signUp(
    "Cook",
    `cooking-${crypto.randomUUID()}@example.test`
  );
  const familyPage = new FamilyPage(page);
  await familyPage.create("Cooking table");
  await familyPage.confirm();
  await page.goto("/?area=tastes");
  await page
    .getByRole("button", { exact: true, name: "Ask our first food question" })
    .click();
  await expect(
    page.getByText("Does pasta work for your family?", { exact: true })
  ).toBeVisible();
  const familiesResponse = await page.request.get("/v1/families");
  const [family] = Schema.decodeUnknownSync(Schema.NonEmptyArray(Family))(
    await familiesResponse.json()
  );
  const seed = await page.request.post("/__test/conversation/seed-recipe", {
    data: { familyId: family.id },
  });
  expect(seed.status(), await seed.text()).toBe(201);
  const { recipeId } = Schema.decodeUnknownSync(
    Schema.Struct({ recipeId: RecipeId })
  )(await seed.json());
  const canonical = await page.request.get(`/v1/recipes/${recipeId}`);
  expect(canonical.ok()).toBe(true);
  await page.goto("/?area=food");
  await page
    .getByRole("button", { exact: true, name: "Mute interaction sounds" })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { exact: true, name: "Enable interaction sounds" })
  ).toBeVisible();
  await page.goto(`/?area=food&recipeId=${recipeId}`);
  const recipe = page.getByRole("dialog");
  await expect(
    recipe.getByRole("heading", { exact: true, name: "Pasta night" })
  ).toBeVisible();
  await expect(recipe.getByText("500 g pasta", { exact: true })).toBeVisible();
  await expect(
    recipe.getByText("Boil the pasta.", { exact: true })
  ).toBeVisible();
  await recipe
    .getByRole("checkbox", {
      exact: true,
      name: "Mark 500 g pasta as gathered",
    })
    .check();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("saved-recipe.png"),
  });
  await recipe
    .getByRole("button", { exact: true, name: "Start cooking" })
    .click();
  await expect(recipe.getByText("Step 1 of 2", { exact: true })).toBeVisible();
  await expect(
    recipe.getByText("Boil the pasta.", { exact: true })
  ).toBeVisible();
  await recipe.getByRole("button", { exact: true, name: "Next step" }).click();
  await expect(recipe.getByText("Step 2 of 2", { exact: true })).toBeVisible();
  await expect(
    recipe.getByText("Drain and stir through the pesto.", { exact: true })
  ).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("cooking-step.png"),
  });
  await recipe.getByRole("button", { exact: true, name: "Previous" }).click();
  await expect(recipe.getByText("Step 1 of 2", { exact: true })).toBeVisible();
  await recipe
    .getByRole("button", { exact: true, name: "Full recipe" })
    .click();
  await expect(
    recipe.getByRole("heading", { exact: true, name: "What you’ll need." })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches
    )
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("meal-planner:interaction-sound")
    )
  ).toBe("off");
});
