import { createHash } from "node:crypto";

import {
  ConversationTurnRequest,
  ConversationView,
} from "@meal-planner/agent-conversations-api";
import { Family } from "@meal-planner/families";
import {
  HouseholdPeopleRoster,
  PersonProfile,
} from "@meal-planner/household-api";
import {
  AssistantTurn,
  DirectoryFrame,
  PrivateRequestSessionSnapshot,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import type { APIRequestContext } from "@playwright/test";
import { Schema } from "effect";

import { expect, test } from "./fixtures.js";
import { AuthPage } from "./pages/auth-page.js";
import { FamilyPage } from "./pages/family-page.js";

const scopes =
  "meal-planner:read meal-planner:write meal-planner:private meal-planner:assistant";
const issueToken = async (client: APIRequestContext, baseURL: string) => {
  const callback = "https://local-agent.test/callback";
  const resource = `${baseURL}/v1`;
  const registered = await client.post("/api/auth/oauth2/register", {
    data: {
      client_name: "Native API journey",
      grant_types: ["authorization_code"],
      redirect_uris: [callback],
      response_types: ["code"],
      scope: scopes,
      token_endpoint_auth_method: "none",
    },
    headers: { origin: baseURL },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const { client_id: clientId } = Schema.decodeUnknownSync(
    Schema.Struct({ client_id: Schema.String })
  )(await registered.json());
  const verifier = "native-agent-journey-verifier-with-more-than-43-characters";
  const authorize = await client.get(
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      client_id: clientId,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "consent",
      redirect_uri: callback,
      resource,
      response_type: "code",
      scope: scopes,
      state: crypto.randomUUID(),
    })}`,
    { maxRedirects: 0 }
  );
  expect(authorize.status()).toBe(302);
  const consentUrl = new URL(authorize.headers()["location"] ?? "", baseURL);
  expect(consentUrl.pathname).toBe("/oauth/consent");
  const consent = await client.post("/api/auth/oauth2/consent", {
    data: { accept: true, oauth_query: consentUrl.search.slice(1) },
    headers: { origin: baseURL },
  });
  expect(consent.status(), await consent.text()).toBe(200);
  const approved = Schema.decodeUnknownSync(
    Schema.Struct({ url: Schema.String })
  )(await consent.json());
  const code = new URL(approved.url).searchParams.get("code");
  if (code === null) {
    throw new Error("Native OAuth did not issue a code.");
  }
  const token = await client.post("/api/auth/oauth2/token", {
    form: {
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: callback,
      resource,
    },
    headers: { origin: baseURL },
  });
  expect(token.status(), await token.text()).toBe(200);
  return {
    ...Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }))(
      await token.json()
    ),
    clientId,
  };
};

test("native OAuth agents submit and poll chat, confirm private cards, and keep bearer identity authoritative", async ({
  page,
  playwright,
  baseURL,
}) => {
  test.setTimeout(90_000);
  if (baseURL === undefined) {
    throw new Error("Expected local Worker URL.");
  }
  await new AuthPage(page).signUp(
    "API cook",
    `agent-request-${crypto.randomUUID()}@example.test`
  );
  const owner = await issueToken(page.request, baseURL);
  const tokenHeaders = { authorization: `Bearer ${owner.access_token}` };
  const initial = await page.request.get("/v1/agent-conversations/setup", {
    headers: tokenHeaders,
  });
  expect(initial.status()).toBe(200);
  const view = Schema.decodeUnknownSync(ConversationView)(await initial.json());
  const turn = Schema.decodeUnknownSync(ConversationTurnRequest)({
    answerToBlockId: null,
    displayedRoster: null,
    expectedVersion: view.version,
    focusPersonId: null,
    foodAnswer: null,
    planId: null,
    text: "Set up my family",
    turnId: `run-${crypto.randomUUID()}`,
  });
  const submitted = await page.request.post(
    "/v1/agent-conversations/setup/turns",
    { data: turn, headers: tokenHeaders }
  );
  expect(submitted.status(), await submitted.text()).toBe(200);
  expect(
    Schema.decodeUnknownSync(ConversationView)(
      await submitted.json()
    ).turns.some((value) => value.id === turn.turnId)
  ).toBe(true);
  await expect
    .poll(async () => {
      const result = await page.request.get("/v1/agent-conversations/setup", {
        headers: tokenHeaders,
      });
      return Schema.decodeUnknownSync(ConversationView)(
        await result.json()
      ).turns.find((value) => value.id === turn.turnId)?.status;
    })
    .toBe("succeeded");
  const replay = await page.request.post(
    "/v1/agent-conversations/setup/turns",
    { data: turn, headers: tokenHeaders }
  );
  expect(replay.status()).toBe(200);
  expect(
    Schema.decodeUnknownSync(ConversationView)(await replay.json()).messages
  ).toHaveLength(2);
  const collision = await page.request.post(
    "/v1/agent-conversations/setup/turns",
    { data: { ...turn, text: "Changed retry" }, headers: tokenHeaders }
  );
  expect(collision.status()).toBe(409);

  const familyPage = new FamilyPage(page);
  await familyPage.create("API private family");
  const familyId = new URL(page.url()).searchParams.get("familyId");
  if (familyId === null) {
    throw new Error("Expected created family ID.");
  }
  await familyPage.confirm();
  const headers = { ...tokenHeaders, "x-meal-planner-household": familyId };
  const familyConversationPath = `/v1/families/${familyId}/agent-conversation`;
  const familyConversation = await page.request.get(familyConversationPath, {
    headers,
  });
  expect(familyConversation.status()).toBe(200);
  const familyView = Schema.decodeUnknownSync(ConversationView)(
    await familyConversation.json()
  );
  const familyTurn = {
    ...turn,
    expectedVersion: familyView.version,
    text: "Ask our first food question",
    turnId: `run-${crypto.randomUUID()}`,
  };
  const familyAccepted = await page.request.post(
    `${familyConversationPath}/turns`,
    { data: familyTurn, headers }
  );
  expect(familyAccepted.status(), await familyAccepted.text()).toBe(200);
  await expect
    .poll(async () => {
      const response = await page.request.get(familyConversationPath, {
        headers,
      });
      return Schema.decodeUnknownSync(ConversationView)(
        await response.json()
      ).turns.find((value) => value.id === familyTurn.turnId)?.status;
    })
    .toBe("succeeded");
  const start = {
    mutationId: crypto.randomUUID(),
    scope: "ProfileEdit",
    type: "StartSession",
  };
  const started = await page.request.post("/v1/private-interviews", {
    data: start,
    headers,
  });
  expect(started.status(), await started.text()).toBe(200);
  const reservation = Schema.decodeUnknownSync(DirectoryFrame.members[1])(
    await started.json()
  );
  const path = `/v1/private-interviews/${reservation.reservation.sessionReference}`;
  const restarted = await page.request.post("/v1/private-interviews", {
    data: start,
    headers,
  });
  expect(await restarted.json()).toEqual(reservation);
  const list = await page.request.get("/v1/private-interviews", { headers });
  expect(
    Schema.decodeUnknownSync(DirectoryFrame.members[2])(await list.json())
      .reservations
  ).toHaveLength(1);
  const read = async (client = page.request, selectedHeaders = headers) => {
    const response = await client.get(path, { headers: selectedHeaders });
    expect(response.status(), await response.text()).toBe(200);
    return Schema.decodeUnknownSync(PrivateRequestSessionSnapshot)(
      await response.json()
    );
  };
  const emptySession = await read();
  expect(emptySession.state.version).toBe(0);
  const privateTurn = {
    expectedVersion: 0,
    text: "I like tomatoes.",
    turnId: `run-${crypto.randomUUID()}`,
  };
  const accepted = await page.request.post(`${path}/turns`, {
    data: privateTurn,
    headers,
  });
  expect(accepted.status(), await accepted.text()).toBe(200);
  expect(
    Schema.decodeUnknownSync(AssistantTurn)(await accepted.json()).id
  ).toBe(privateTurn.turnId);
  await expect
    .poll(async () => {
      const result = await read();
      return result.assistantTurn?.status;
    })
    .toBe("succeeded");
  const snapshot = await read();
  expect(snapshot.messages).toHaveLength(2);
  const privateReplay = await page.request.post(`${path}/turns`, {
    data: privateTurn,
    headers,
  });
  expect(privateReplay.status()).toBe(200);
  const privateCollision = await page.request.post(`${path}/turns`, {
    data: { ...privateTurn, text: "Different retry" },
    headers,
  });
  expect(privateCollision.status()).toBe(409);
  const [card] = snapshot.cards;
  if (card === undefined) {
    throw new Error("Expected native private profile card.");
  }
  const mutationId = crypto.randomUUID();
  const premature = await page.request.post(
    `${path}/confirmations/${mutationId}/continue`,
    { headers }
  );
  expect(premature.status()).toBe(403);
  const confirmed = await page.request.post(`${path}/commands`, {
    data: {
      cardId: card.id,
      cardRevision: card.revision,
      expectedVersion: snapshot.state.version,
      mutationId,
      safetyConfirmation: null,
      type: "ConfirmProfileCard",
    },
    headers,
  });
  expect(confirmed.status(), await confirmed.text()).toBe(200);
  expect(
    Schema.decodeUnknownSync(SessionFrame)(await confirmed.json()).type
  ).toBe("ConfirmationPending");
  const continued = await page.request.post(
    `${path}/confirmations/${mutationId}/continue`,
    { headers }
  );
  expect(continued.status(), await continued.text()).toBe(200);
  const settled = Schema.decodeUnknownSync(PrivateRequestSessionSnapshot)(
    await continued.json()
  );
  expect(settled.cards[0]?.status).toBe("confirmed");
  const repeated = await page.request.post(
    `${path}/confirmations/${mutationId}/continue`,
    { headers }
  );
  expect(await repeated.json()).toEqual(settled);
  const roster = await page.request.get(`/v1/families/${familyId}/people`, {
    headers,
  });
  const personId = Schema.decodeUnknownSync(HouseholdPeopleRoster)(
    await roster.json()
  ).currentPersonId;
  const profile = await page.request.get(
    `/v1/families/${familyId}/people/${personId}/profile`,
    { headers }
  );
  expect(
    Schema.decodeUnknownSync(PersonProfile)(await profile.json()).facts[0]
      ?.value
  ).toMatchObject({ label: "Tomatoes" });

  const other = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { "x-test-client-ip": "198.19.22.2" },
  });
  try {
    const signup = await other.post("/api/auth/sign-up/email", {
      data: {
        email: `other-agent-${crypto.randomUUID()}@example.test`,
        name: "Other account",
        password: "Native-other-account-password-29!",
      },
      headers: { origin: baseURL },
    });
    expect(signup.status()).toBe(200);
    const otherFamily = await other.post("/v1/families", {
      data: { mutationId: crypto.randomUUID(), name: "Other family" },
      headers: { origin: baseURL },
    });
    expect(otherFamily.status(), await otherFamily.text()).toBe(200);
    const otherId = Schema.decodeUnknownSync(Family)(
      await otherFamily.json()
    ).id;
    const otherToken = await issueToken(other, baseURL);
    const denied = await page.request.get(path, {
      headers: {
        authorization: `Bearer ${otherToken.access_token}`,
        "x-meal-planner-household": familyId,
      },
    });
    expect(denied.status()).toBe(403);
    const deniedFamily = await other.post(`${familyConversationPath}/turns`, {
      data: { ...familyTurn, turnId: `run-${crypto.randomUUID()}` },
      headers: {
        authorization: `Bearer ${otherToken.access_token}`,
        "x-meal-planner-household": familyId,
      },
    });
    expect(deniedFamily.status()).toBe(403);
    const otherPrivate = await other.get(path, {
      headers: {
        authorization: `Bearer ${otherToken.access_token}`,
        "x-meal-planner-household": otherId,
      },
    });
    expect(otherPrivate.ok()).toBe(false);
    expect(await otherPrivate.text()).not.toContain("Tomatoes");
    const ownerWithOtherCookie = await read(other);
    expect(ownerWithOtherCookie.messages).toEqual(settled.messages);
    const revoked = await page.request.post("/api/auth/oauth2/revoke", {
      form: {
        client_id: owner.clientId,
        token: owner.access_token,
        token_type_hint: "access_token",
      },
      headers: { origin: baseURL },
    });
    expect(revoked.status()).toBe(200);
    const noFallback = await page.request.get(path, { headers });
    expect(noFallback.status()).toBe(401);
  } finally {
    await other.dispose();
  }
});
