import { ConversationAction } from "@meal-planner/agent-conversations-api";
import { Family } from "@meal-planner/families";
import {
  HouseholdPeopleRoster,
  PersonProfile,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { expect, test } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";

test("a reviewed agent roster survives a lost save response and leads into food discovery", async ({
  page,
}) => {
  await new AuthPage(page).signUp(
    "Alex",
    `agent-journey-${crypto.randomUUID()}@example.test`
  );
  await page
    .getByRole("textbox", { exact: true, name: "Tell us about your family" })
    .fill("Set up my family");
  await page.getByRole("button", { exact: true, name: "Send message" }).click();
  await expect(page.getByLabel("Family name", { exact: true })).toHaveValue(
    "The Test Table"
  );
  await page
    .getByLabel("Family name", { exact: true })
    .fill("Our reviewed table");

  const submissions: ConversationAction[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/agent-conversations/setup/actions")
    ) {
      submissions.push(
        Schema.decodeUnknownSync(ConversationAction)(request.postDataJSON())
      );
    }
  });
  const fault = await page.request.post(
    "/__test/conversation/lose-next-advance"
  );
  expect(fault.ok()).toBe(true);
  await page
    .getByRole("button", { exact: true, name: "Create our family" })
    .click();
  await expect(
    page.getByRole("button", { exact: true, name: "Check and continue" })
  ).toBeVisible();

  const firstRead = await page.request.get("/v1/families");
  expect(firstRead.ok()).toBe(true);
  const families = Schema.decodeUnknownSync(Schema.NonEmptyArray(Family))(
    await firstRead.json()
  );
  expect(families).toHaveLength(1);
  expect(families[0]?.name).toBe("Our reviewed table");
  await page
    .getByRole("button", { exact: true, name: "Check and continue" })
    .click();
  const family = new FamilyPage(page);
  await family.expectReview();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);

  const familyId = families[0].id;
  const peopleResponse = await page.request.get(
    `/v1/families/${familyId}/people`
  );
  expect(peopleResponse.ok()).toBe(true);
  const people = Schema.decodeUnknownSync(HouseholdPeopleRoster)(
    await peopleResponse.json()
  );
  expect(people.people.map((person) => person.displayName).toSorted()).toEqual([
    "Alex",
    "Sam",
  ]);
  const sam = people.people.find((person) => person.displayName === "Sam");
  expect(sam?.kind).toBe("dependant");
  if (sam === undefined) {
    throw new Error("The reviewed child must be saved.");
  }
  await page.reload();
  await family.expectReview();
  await family.confirm();
  await page.goto("/?area=tastes");
  await expect(
    page.getByRole("heading", { name: "Find the food they say yes to." })
  ).toBeVisible();

  const conversation = page.getByRole("region", {
    exact: true,
    name: "Food conversation",
  });
  await conversation
    .getByRole("button", { exact: true, name: "Ask our first food question" })
    .click();
  await expect(
    page.getByText("Does pasta work for your family?", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "Yes" })
  ).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Yes" }).click();
  await expect(
    conversation.getByText("Answered", { exact: true })
  ).toBeVisible();
  await expect(
    conversation.getByText("Who enjoys it most?", { exact: true })
  ).toBeVisible();

  await conversation
    .getByRole("textbox", { exact: true, name: "Your message" })
    .fill("Sam likes pasta");
  await conversation
    .getByRole("button", { exact: true, name: "Send message" })
    .click();
  await conversation
    .getByRole("button", { exact: true, name: "Review food fact" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { exact: true, name: "Confirm for family" })
    .click();
  await expect(
    conversation.getByText("Confirmed for family", { exact: true })
  ).toBeVisible();

  const savedProfile = await page.request.get(
    `/v1/families/${familyId}/people/${sam.id}/profile`
  );
  expect(savedProfile.ok()).toBe(true);
  const profile = Schema.decodeUnknownSync(PersonProfile)(
    await savedProfile.json()
  );
  expect(profile.facts).toHaveLength(1);
  expect(profile.facts[0]?.value).toMatchObject({
    _tag: "FoodPreference",
    label: "Pasta",
    sentiment: "like",
  });
  await page.reload();
  await expect(
    conversation.getByText("Confirmed for family", { exact: true })
  ).toBeVisible();
});

test("family conversation requires a linked active adult as well as account membership", async ({
  page,
  browser,
}) => {
  await new AuthPage(page).signUp(
    "Owner",
    `conversation-owner-${crypto.randomUUID()}@example.test`
  );
  await new FamilyPage(page).create("Private family table");
  const familiesResponse = await page.request.get("/v1/families");
  const [family] = Schema.decodeUnknownSync(Schema.NonEmptyArray(Family))(
    await familiesResponse.json()
  );
  const path = `/v1/families/${family.id}/agent-conversation`;
  const other = await browser.newContext({
    extraHTTPHeaders: { "x-test-client-ip": "198.18.90.1" },
  });
  try {
    const otherPage = await other.newPage();
    await new AuthPage(otherPage).signUp(
      "Unlinked member",
      `conversation-unlinked-${crypto.randomUUID()}@example.test`
    );
    const membership = await otherPage.request.post(
      "/__test/conversation/add-unlinked-membership",
      { data: { familyId: family.id } }
    );
    expect(membership.ok()).toBe(true);
    const read = await otherPage.request.get(path);
    expect(read.status()).toBe(403);
    const action = await otherPage.request.post(`${path}/actions`, {
      data: Schema.decodeUnknownSync(ConversationAction)({
        actionId: crypto.randomUUID(),
        blockId: crypto.randomUUID(),
        decision: "dismiss",
        expectedRevision: 1,
      }),
    });
    expect(action.status()).toBe(403);
    const chat = await otherPage.request.post(`${path}/chat`, { data: {} });
    expect(chat.status()).toBe(403);
  } finally {
    await other.close();
  }
});
