import { Schema } from "effect";
import { expect } from "vitest";

import type { MealPlannerAuth } from "./auth.js";

/** Exercise the provider's public wire flow; never insert issued credentials. */
export const makeOAuthFlowFixture = (
  auth: MealPlannerAuth,
  baseURL: string
) => {
  const post = (path: string, body: object, cookie?: string) => {
    const headers = new Headers({
      "cf-connecting-ip": "192.0.2.85",
      "content-type": "application/json",
      origin: baseURL,
    });
    if (cookie !== undefined) {
      headers.set("cookie", cookie);
    }
    return auth.fetch(
      new Request(`${baseURL}/api/auth${path}`, {
        body: JSON.stringify(body),
        headers,
        method: "POST",
      })
    );
  };
  const form = (path: string, body: Record<string, string>) =>
    auth.fetch(
      new Request(`${baseURL}/api/auth${path}`, {
        body: new URLSearchParams(body),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      })
    );
  return {
    createAccount: async () => {
      const response = await post("/sign-up/email", {
        email: `${crypto.randomUUID()}@example.test`,
        name: "Product connection fixture",
        password: "local-worker-password-only",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
      if (cookie === undefined) {
        throw new Error("Expected native session cookie.");
      }
      const account = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      if (account === null) {
        throw new Error("Expected native session.");
      }
      return { ...account, cookie };
    },
    issueTokens: async (cookie: string, resource: string, scope: string) => {
      const redirectUri = "https://client.example.test/oauth/callback";
      const registered = await post("/oauth2/register", {
        client_name: "Product connection fixture",
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [redirectUri],
        response_types: ["code"],
        scope,
        token_endpoint_auth_method: "none",
      });
      expect(registered.status, await registered.clone().text()).toBe(201);
      const { client_id: clientId } = Schema.decodeUnknownSync(
        Schema.Struct({ client_id: Schema.String })
      )(await registered.json());
      const verifier =
        crypto.randomUUID().replaceAll("-", "") +
        crypto.randomUUID().replaceAll("-", "");
      const digest = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier)
        )
      );
      const challenge = btoa(String.fromCodePoint(...digest))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      const state = crypto.randomUUID();
      const query = new URLSearchParams({
        client_id: clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "consent",
        redirect_uri: redirectUri,
        resource,
        response_type: "code",
        scope,
        state,
      });
      const authorization = await auth.fetch(
        new Request(`${baseURL}/api/auth/oauth2/authorize?${query}`, {
          headers: { cookie },
        })
      );
      expect(authorization.status, await authorization.clone().text()).toBe(
        302
      );
      const location = authorization.headers.get("location");
      if (location === null) {
        throw new Error("Expected consent redirect.");
      }
      const consentPage = new URL(location, baseURL);
      expect(consentPage.pathname).toBe("/oauth/consent");
      const consent = await post(
        "/oauth2/consent",
        { accept: true, oauth_query: consentPage.search.slice(1) },
        cookie
      );
      expect(consent.status, await consent.clone().text()).toBe(200);
      const approved = Schema.decodeUnknownSync(
        Schema.Struct({ url: Schema.String })
      )(await consent.json());
      const callback = new URL(approved.url);
      expect(callback.origin + callback.pathname).toBe(redirectUri);
      expect(callback.searchParams.get("state")).toBe(state);
      const code = callback.searchParams.get("code");
      if (code === null) {
        throw new Error("Expected authorization code.");
      }
      const response = await form("/oauth2/token", {
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        resource,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return {
        ...Schema.decodeUnknownSync(
          Schema.Struct({
            access_token: Schema.String,
            scope: Schema.String,
            token_type: Schema.String,
          })
        )(await response.json()),
        clientId,
      };
    },
    revoke: async (clientId: string, token: string) => {
      const response = await form("/oauth2/revoke", {
        client_id: clientId,
        token,
        token_type_hint: "access_token",
      });
      expect(response.status, await response.clone().text()).toBe(200);
    },
  };
};
