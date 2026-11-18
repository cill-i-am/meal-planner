import { Schema } from "effect";

import type { MealPlannerApiService } from "./api-proxy.js";
import {
  parseAuthorizationRequest,
  permissionDescriptions,
} from "./authorization-request.js";

const Session = Schema.Struct({
  user: Schema.Struct({ email: Schema.String, id: Schema.String }),
});
const Client = Schema.Struct({
  client_id: Schema.String,
  client_name: Schema.optional(Schema.String),
});
const Redirect = Schema.Struct({ url: Schema.String });
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!DOCTYPE html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Meal Planner</title><main><h1>${title}</h1>${body}</main></html>`,
    {
      headers: {
        "cache-control": "private, no-store",
        "content-security-policy":
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "same-origin",
        "x-robots-tag": "noindex",
      },
      status,
    }
  );

const input = (
  label: string,
  name: string,
  type: string,
  autocomplete: string
) =>
  `<p><label>${label} <input name="${name}" type="${type}" autocomplete="${autocomplete}" required></label></p>`;

const email = input("Email", "email", "email", "email");
const accountForms = {
  "/forgot-password": {
    endpoint: "/request-password-reset",
    fields: email,
    title: "Request a password reset",
  },
  "/login": {
    endpoint: "/sign-in/email",
    fields:
      email + input("Password", "password", "password", "current-password"),
    title: "Sign in",
  },
  "/reset-password": {
    endpoint: "/reset-password",
    fields: input("New password", "newPassword", "password", "new-password"),
    title: "Reset password",
  },
  "/signup": {
    endpoint: "/sign-up/email",
    fields:
      input("Name", "name", "text", "name") +
      email +
      input("Password", "password", "password", "new-password"),
    title: "Create account",
  },
} as const;

const authRequest = (
  api: MealPlannerApiService,
  request: Request,
  path: string,
  body?: object,
  userId?: string
) => {
  const headers = new Headers();
  for (const key of ["cookie", "cf-connecting-ip", "user-agent"]) {
    const value = request.headers.get(key);
    if (value) {
      headers.set(key, value);
    }
  }
  if (userId) {
    headers.set("x-meal-planner-user", userId);
  }
  if (body) {
    headers.set("content-type", "application/json");
    headers.set("origin", new URL(request.url).origin);
  }
  return api.fetch(
    new Request(new URL(`/api/auth${path}`, request.url), {
      body: body ? JSON.stringify(body) : null,
      headers,
      method: body ? "POST" : "GET",
      redirect: "manual",
    })
  );
};

const unavailable = () =>
  page(
    "Connection unavailable",
    "Return to the app and start a new connection.",
    400
  );
const continueTo = (location: string, source: Response) => {
  const headers = new Headers({
    "cache-control": "no-store",
    location,
    "referrer-policy": "same-origin",
  });
  for (const cookie of source.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { headers, status: 303 });
};

const consent = async (
  api: MealPlannerApiService,
  request: Request,
  url: URL
) => {
  const grant = parseAuthorizationRequest(url.search);
  if (!grant) {
    return unavailable();
  }
  const oauthQuery = url.search.slice(1);
  const known = grant.scopes.every((scope) =>
    Object.hasOwn(permissionDescriptions, scope)
  );
  if (request.method === "POST") {
    const form = await request.formData();
    const choice = form.get("choice");
    const user = form.get("user");
    if (
      !Schema.is(Schema.NonEmptyString)(user) ||
      !(choice === "deny" || (known && choice === "allow"))
    ) {
      return unavailable();
    }
    const response = await authRequest(
      api,
      request,
      "/oauth2/consent",
      { accept: choice === "allow", oauth_query: oauthQuery },
      user
    );
    if (!response.ok) {
      return unavailable();
    }
    const redirect = Schema.decodeUnknownSync(Redirect)(await response.json());
    return continueTo(redirect.url, response);
  }
  const session = await authRequest(api, request, "/get-session");
  if (!session.ok) {
    return unavailable();
  }
  const account = Schema.decodeUnknownSync(Schema.NullOr(Session))(
    await session.json()
  );
  if (!account) {
    return continueTo(`/login${url.search}`, session);
  }
  const metadata = await authRequest(
    api,
    request,
    "/oauth2/public-client-prelogin",
    { client_id: grant.clientId, oauth_query: oauthQuery },
    account.user.id
  );
  if (!metadata.ok) {
    return unavailable();
  }
  const client = Schema.decodeUnknownSync(Client)(await metadata.json());
  if (client.client_id !== grant.clientId) {
    return unavailable();
  }
  const permissions = grant.scopes
    .map(
      (scope) =>
        `<li>${escape(Object.hasOwn(permissionDescriptions, scope) ? (permissionDescriptions[scope] ?? scope) : scope)}</li>`
    )
    .join("");
  return page(
    "Connect to Meal Planner",
    `<p>App: ${escape(client.client_name || grant.clientId)} (${escape(grant.clientId)})</p><p>Connect only if you recognise this app and started this request.</p><p>Signed in as ${escape(account.user.email)}</p><ul>${permissions}</ul><form method="post"><input type="hidden" name="user" value="${escape(account.user.id)}"><button name="choice" value="deny">Deny</button> <button name="choice" value="allow" ${known ? "" : "disabled"}>Allow access</button></form>`
  );
};

const isAccountPath = (path: string): path is keyof typeof accountForms =>
  Object.hasOwn(accountForms, path);

const accountPayload = (
  path: keyof typeof accountForms,
  form: FormData,
  url: URL,
  query: string
) => {
  if (path === "/reset-password") {
    return {
      newPassword: form.get("newPassword"),
      token: url.searchParams.get("token"),
    };
  }
  if (path === "/forgot-password") {
    return {
      email: form.get("email"),
      redirectTo: `${url.origin}/reset-password`,
    };
  }
  return {
    email: form.get("email"),
    name: path === "/signup" ? form.get("name") : undefined,
    oauth_query: query ? query.slice(1) : undefined,
    password: form.get("password"),
  };
};

export const handleAccountRequest = async (
  request: Request,
  api: MealPlannerApiService
) => {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!isAccountPath(path) && path !== "/oauth/consent") {
    return new Response(null, { status: 404 });
  }
  if (!["GET", "POST"].includes(request.method)) {
    return new Response(null, { headers: { allow: "GET, POST" }, status: 405 });
  }
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== url.origin
  ) {
    return new Response(null, { status: 403 });
  }
  if (
    request.method === "POST" &&
    request.headers.get("content-type")?.split(";")[0] !==
      "application/x-www-form-urlencoded"
  ) {
    return new Response(null, { status: 415 });
  }
  if (path === "/oauth/consent") {
    return consent(api, request, url);
  }
  const entry = accountForms[path];
  const query = url.searchParams.has("sig") ? url.search : "";
  if (request.method === "GET") {
    const links =
      path === "/login"
        ? `<p><a href="/signup${escape(query)}">Create account</a> · <a href="/forgot-password">Forgot password?</a></p>`
        : "";
    return page(
      entry.title,
      `<form method="post">${entry.fields}<button>${entry.title}</button></form>${links}`
    );
  }
  const form = await request.formData();
  const response = await authRequest(
    api,
    request,
    entry.endpoint,
    accountPayload(path, form, url, query)
  );
  if (!response.ok) {
    return page(
      entry.title,
      "The request could not be completed. Return to the previous page to try again.",
      response.status
    );
  }
  if (query && (path === "/login" || path === "/signup")) {
    const redirect = Schema.decodeUnknownSync(Redirect)(await response.json());
    return continueTo(redirect.url, response);
  }
  const result = page(
    entry.title,
    path === "/forgot-password"
      ? "Check your email for a password reset link."
      : "Return to your connected app to continue."
  );
  for (const cookie of response.headers.getSetCookie()) {
    result.headers.append("set-cookie", cookie);
  }
  return result;
};
