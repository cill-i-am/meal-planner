import {
  ConversationAction,
  ConversationChatMetadata,
  ConversationView,
} from "@meal-planner/agent-conversations-api";
import { Family } from "@meal-planner/families";
import {
  HouseholdPeopleRoster,
  PersonProfile,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { expect, test } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";

test("a setup roster cannot be saved without its conversational confirmation", async ({
  page,
}) => {
  await new AuthPage(page).signUp(
    "Alex",
    `agent-unconfirmed-${crypto.randomUUID()}@example.test`
  );
  await page
    .getByRole("textbox", { exact: true, name: "Your message" })
    .fill("Me, my partner Sam and our kids Maya and Leo.");
  await page.getByRole("button", { exact: true, name: "Send message" }).click();
  await expect(
    page
      .getByRole("region", { name: "Your family table" })
      .getByRole("heading", { name: "Alex’s family" })
  ).toBeVisible();

  const read = await page.request.get("/v1/agent-conversations/setup");
  expect(read.ok()).toBe(true);
  const view = Schema.decodeUnknownSync(ConversationView)(await read.json());
  const roster = view.blocks.findLast(
    (block) => block._tag === "RosterProposal" && block.status === "proposed"
  );
  if (roster?._tag !== "RosterProposal") {
    throw new Error("Expected the current proposed roster");
  }
  const action = Schema.decodeUnknownSync(ConversationAction)({
    actionId: crypto.randomUUID(),
    blockId: roster.id,
    decision: "accept",
    expectedRevision: roster.revision,
    reviewedRoster: {
      creatorName: roster.creatorName,
      familyName: roster.familyName,
      people: roster.people,
    },
    safetyConfirmation: null,
  });
  const save = await page.request.post(
    "/v1/agent-conversations/setup/actions",
    { data: action, headers: { origin: new URL(page.url()).origin } }
  );
  expect(save.status()).toBe(409);

  const after = await page.request.get("/v1/agent-conversations/setup");
  expect(after.ok()).toBe(true);
  expect(
    Schema.decodeUnknownSync(ConversationView)(await after.json()).actions
  ).toEqual([]);

  const familiesResponse = await page.request.get("/v1/families");
  expect(familiesResponse.ok()).toBe(true);
  expect(
    Schema.decodeUnknownSync(Schema.Array(Family))(
      await familiesResponse.json()
    )
  ).toEqual([]);
});

test("keeps setup input blocked until the completed reply's canonical roster arrives", async ({
  page,
}) => {
  await new AuthPage(page).signUp(
    "Alex",
    `agent-refresh-${crypto.randomUUID()}@example.test`
  );
  const composer = page.getByRole("textbox", {
    exact: true,
    name: "Your message",
  });
  const send = page.getByRole("button", { exact: true, name: "Send message" });
  await composer.fill("Me, my partner Sam and our kids Maya and Leo.");
  await send.click();
  await expect(
    page
      .getByRole("region", { name: "Your family table" })
      .getByRole("heading", { name: "Alex’s family" })
  ).toBeVisible();

  const { promise: refreshReleased, resolve: releaseRefresh } =
    Promise.withResolvers<null>();
  const { promise: refreshCaptured, resolve: captureRefresh } =
    Promise.withResolvers<typeof ConversationView.Type>();
  await page.route("**/v1/agent-conversations/setup", async (route) => {
    const response = await route.fetch();
    captureRefresh(
      Schema.decodeUnknownSync(ConversationView)(await response.json())
    );
    await refreshReleased;
    await route.fulfill({ response });
  });
  try {
    const correctionResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/agent-conversations/setup/chat") &&
        response.request().method() === "POST"
    );
    await composer.fill("Sam is an adult.");
    await send.click();
    const correction = await correctionResponse;
    expect(correction.ok()).toBe(true);
    const refreshed = await refreshCaptured;
    expect(refreshed.turns.at(-1)?.status).toBe("succeeded");
    await expect(composer).toBeDisabled();
    await expect(send).toBeDisabled();
    await expect(
      page
        .getByRole("region", { name: "Family conversation" })
        .getByRole("status")
    ).toHaveText("Thinking…");

    releaseRefresh(null);
    await expect(composer).toBeEnabled();
    const roster = refreshed.blocks.findLast(
      (block) => block._tag === "RosterProposal" && block.status === "proposed"
    );
    if (roster?._tag !== "RosterProposal") {
      throw new Error("Expected the refreshed proposed roster");
    }
    const confirmationResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/agent-conversations/setup/chat") &&
        response.request().method() === "POST"
    );
    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/agent-conversations/setup/actions") &&
        response.request().method() === "POST"
    );
    await composer.fill("Yes, everyone looks right.");
    await send.click();
    const confirmation = await confirmationResponse;
    expect(confirmation.ok()).toBe(true);
    const metadata = Schema.decodeUnknownSync(ConversationChatMetadata)(
      confirmation.request().postDataJSON().data
    );
    expect(metadata.expectedVersion).toBe(refreshed.version);
    expect(metadata.displayedRoster).toEqual({
      blockId: roster.id,
      revision: roster.revision,
    });
    const save = await saveResponse;
    expect(save.ok()).toBe(true);
    const action = Schema.decodeUnknownSync(ConversationAction)(
      save.request().postDataJSON()
    );
    expect(action.blockId).toBe(roster.id);
    expect(action.expectedRevision).toBe(roster.revision);
    await expect(
      page.getByRole("heading", { name: "Find the food they say yes to." })
    ).toBeVisible();
  } finally {
    releaseRefresh(null);
  }
});

test("chat corrections, confirmation and a lost save lead into food discovery", async ({
  page,
}) => {
  await new AuthPage(page).signUp(
    "Alex",
    `agent-journey-${crypto.randomUUID()}@example.test`
  );
  const sendSetup = async (message: string) => {
    await page
      .getByRole("textbox", { exact: true, name: "Your message" })
      .fill(message);
    await page
      .getByRole("button", { exact: true, name: "Send message" })
      .click();
  };
  const table = page.getByRole("region", { name: "Your family table" });
  await sendSetup("Me, my partner Sam and our kids Maya and Leo.");
  await expect(
    table.getByRole("heading", { name: "Alex’s family" })
  ).toBeVisible();
  await expect(
    table.getByRole("list", { name: "Family members" })
  ).toContainText("Leo");
  await expect(page.getByLabel("Family name", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create our family" })
  ).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await sendSetup("Change Leo to Theo, and call us the River family.");
  await expect(
    table.getByRole("heading", { name: "River family" })
  ).toBeVisible();
  await expect(
    table.getByRole("list", { name: "Family members" })
  ).toContainText("Theo");
  await expect(
    table.getByRole("list", { name: "Family members" })
  ).not.toContainText("Leo");
  await sendSetup("Sam is an adult.");
  await expect(
    table.getByRole("list", { name: "Family members" })
  ).toContainText("SamAdult");

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
  await sendSetup("Yes, everyone looks right.");
  await expect(
    page.getByRole("button", { exact: true, name: "Check save" })
  ).toBeVisible();

  const firstRead = await page.request.get("/v1/families");
  expect(firstRead.ok()).toBe(true);
  const families = Schema.decodeUnknownSync(Schema.NonEmptyArray(Family))(
    await firstRead.json()
  );
  expect(families).toHaveLength(1);
  expect(families[0]?.name).toBe("River family");
  await page.getByRole("button", { exact: true, name: "Check save" }).click();
  await expect(
    page.getByRole("heading", { name: "Find the food they say yes to." })
  ).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(submissions[0]).toMatchObject({
    decision: "accept",
    reviewedRoster: {
      creatorName: "Alex",
      familyName: "River family",
      people: [
        { displayName: "Sam", kind: "adult" },
        { displayName: "Maya", kind: "dependant" },
        { displayName: "Theo", kind: "dependant" },
      ],
    },
  });

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
    "Maya",
    "Sam",
    "Theo",
  ]);
  expect(
    people.people.find((person) => person.displayName === "Sam")?.kind
  ).toBe("adult");
  const maya = people.people.find((person) => person.displayName === "Maya");
  if (maya === undefined) {
    throw new Error("The confirmed child must be saved.");
  }
  await page.reload();
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
    .fill("Maya likes pasta");
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
    `/v1/families/${familyId}/people/${maya.id}/profile`
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

test("a lost confirmation response recovers on reload without a second family", async ({
  page,
}) => {
  await new AuthPage(page).signUp(
    "Alex",
    `agent-reload-${crypto.randomUUID()}@example.test`
  );
  const composer = page.getByRole("textbox", {
    exact: true,
    name: "Your message",
  });
  await composer.fill("Me, my partner Sam and our kids Maya and Leo.");
  await page.getByRole("button", { exact: true, name: "Send message" }).click();
  await expect(
    page
      .getByRole("region", { name: "Your family table" })
      .getByRole("heading", { name: "Alex’s family" })
  ).toBeVisible();
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
  await composer.fill("Yes, everyone looks right.");
  await page.getByRole("button", { exact: true, name: "Send message" }).click();
  await expect(
    page.getByRole("button", { exact: true, name: "Check save" })
  ).toBeVisible();
  expect(submissions).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("button", { exact: true, name: "Check save" })
  ).toBeVisible();
  expect(submissions).toHaveLength(1);
  await page.getByRole("button", { exact: true, name: "Check save" }).click();
  await expect(
    page.getByRole("heading", { name: "Find the food they say yes to." })
  ).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  const response = await page.request.get("/v1/families");
  const families = Schema.decodeUnknownSync(Schema.NonEmptyArray(Family))(
    await response.json()
  );
  expect(families).toHaveLength(1);
  expect(families[0]?.name).toBe("Alex’s family");
  expect(families[0]?.setup.status).toBe("complete");
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
