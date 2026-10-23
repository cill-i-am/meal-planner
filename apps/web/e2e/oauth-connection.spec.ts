import { createHash } from "node:crypto";

import { Schema } from "effect";

import { test, expect } from "./fixtures.js";

const ClientRegistration = Schema.Struct({ client_id: Schema.String });
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  scope: Schema.String,
  token_type: Schema.String,
});

test("native OAuth survives direct SSR, browser login and consent, exchanges a PKCE code and returns a denial", async ({
  browser,
  context,
  page,
  playwright,
  request,
  baseURL,
}) => {
  test.setTimeout(60_000);
  if (baseURL === undefined) {
    throw new Error(
      "The native OAuth journey requires the local Worker base URL."
    );
  }
  const email = `oauth-${crypto.randomUUID()}@example.test`;
  const password = "Local-OAuth-test-password-29!";
  const signup = await request.post("/api/auth/sign-up/email", {
    data: { email, name: "OAuth cook", password },
    headers: { origin: baseURL },
  });
  expect(signup.status()).toBe(200);
  const callback = `${baseURL}/__test/oauth-callback`;
  const resource = `${baseURL}/mcp`;
  const scope = "meal-planner:read offline_access";
  const registration = await request.post("/api/auth/oauth2/register", {
    data: {
      client_name: "Local OAuth client",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [callback],
      response_types: ["code"],
      scope,
      token_endpoint_auth_method: "none",
    },
    headers: { origin: baseURL },
  });
  expect(registration.status(), await registration.text()).toBe(201);
  const { client_id: clientId } = Schema.decodeUnknownSync(ClientRegistration)(
    await registration.json()
  );
  const verifier = "a-local-pkce-verifier-that-is-over-43-characters-long";
  const state = crypto.randomUUID();
  const authorization = new URLSearchParams({
    client_id: clientId,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: callback,
    resource,
    response_type: "code",
    scope,
    state,
  });
  // This is the test client's callback; the authorization server and token exchange are native.
  await page.route("**/__test/oauth-callback?**", (route) =>
    route.fulfill({
      body: "<h1>OAuth client callback</h1>",
      contentType: "text/html",
    })
  );
  await page.goto(`/api/auth/oauth2/authorize?${authorization}`);
  await expect(page).toHaveURL(/\/login\?/u);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { exact: true, name: "Log in" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect to Meal Planner" })
  ).toBeVisible();
  await expect(
    page.getByText("Local OAuth client", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(/Identity not verified by Meal Planner/u)
  ).toBeVisible();

  const staticContext = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await context.storageState(),
  });
  try {
    const staticPage = await staticContext.newPage();
    const response = await staticPage.goto(page.url());
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(
      staticPage.getByRole("heading", { name: "Connect to Meal Planner" })
    ).toBeVisible();
    await expect(
      staticPage.getByRole("button", { name: "Allow access" })
    ).toBeDisabled();
    await expect(
      staticPage.getByRole("button", { name: "Deny" })
    ).toBeDisabled();
  } finally {
    await staticContext.close();
  }

  await page.getByRole("button", { name: "Allow access" }).click();
  await expect(
    page.getByRole("heading", { name: "OAuth client callback" })
  ).toBeVisible();
  const accepted = new URL(page.url());
  expect(accepted.searchParams.get("state")).toBe(state);
  const code = accepted.searchParams.get("code");
  if (code === null) {
    throw new Error(
      "The native provider did not return an authorization code."
    );
  }
  const tokenClient = await playwright.request.newContext({ baseURL });
  try {
    const exchange = await tokenClient.post("/api/auth/oauth2/token", {
      form: {
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: callback,
        resource,
      },
    });
    expect(exchange.status()).toBe(200);
    const token = Schema.decodeUnknownSync(TokenResponse)(
      await exchange.json()
    );
    expect(token.scope).toBe(scope);
    expect(token.token_type).toBe("Bearer");
    expect(token.access_token.length).toBeGreaterThan(0);
    expect(token.refresh_token.length).toBeGreaterThan(0);
  } finally {
    await tokenClient.dispose();
  }

  const deniedState = crypto.randomUUID();
  authorization.set("state", deniedState);
  await page.goto(`/api/auth/oauth2/authorize?${authorization}`);
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(
    page.getByRole("heading", { name: "OAuth client callback" })
  ).toBeVisible();
  const denied = new URL(page.url());
  expect(denied.searchParams.get("state")).toBe(deniedState);
  expect(denied.searchParams.get("error")).toBe("access_denied");
  expect(denied.searchParams.has("code")).toBe(false);
});
