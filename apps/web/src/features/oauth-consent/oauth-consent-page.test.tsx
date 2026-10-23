import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";

import { Route as LoginRoute } from "../../routes/login.js";
import { Route as SignupRoute } from "../../routes/signup.js";
import {
  AuthClientContext,
  decodeAuthEntrySearch,
  makeAuthClient,
} from "../auth/index.js";
import { parseAuthorizationRequest } from "./authorization-request.js";
import { OAuthConsentPage } from "./oauth-consent-page.js";

const signedQuery =
  "?client_id=client-1&scope=meal-planner%3Aread+meal-planner%3Aprivate+offline_access&resource=https%3A%2F%2Fmeal.test%2Fmcp&resource=https%3A%2F%2Fmeal.test%2Fv1&ba_param=client_id&ba_param=scope&sig=test%2Bsignature";
const account = {
  session: {},
  user: { email: "cook@example.com", id: "adult-1", name: "Cook" },
};
const originalHref = window.location.href;
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) {
    client.clear();
  }
  window.history.replaceState(null, "", originalHref);
});

const setup = async ({
  entry = `/oauth/consent${signedQuery}`,
  authenticated = true,
  metadataStatus = 200,
  consentStatus = 200,
  clientName = "My assistant",
  responseClientId = "client-1",
}: {
  readonly entry?: string;
  readonly authenticated?: boolean;
  readonly metadataStatus?: number;
  readonly consentStatus?: number;
  readonly clientName?: string;
  readonly responseClientId?: string;
} = {}) => {
  const requests: { path: string; body: unknown; user: string | null }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const body: unknown =
      request.method === "POST" ? await request.json() : null;
    requests.push({
      body,
      path,
      user: request.headers.get("x-meal-planner-user"),
    });
    if (path.endsWith("/get-session")) {
      return Response.json(authenticated ? account : null);
    }
    if (path.endsWith("/oauth2/public-client-prelogin")) {
      return metadataStatus === 200
        ? Response.json({
            client_id: responseClientId,
            client_name: clientName,
            // eslint-disable-next-line no-script-url -- Untrusted metadata must remain inert text in the consent UI.
            client_uri: "javascript:alert('untrusted metadata')",
          })
        : Response.json(
            { error: "invalid_signature", message: "private provider detail" },
            { status: metadataStatus }
          );
    }
    if (path.endsWith("/oauth2/consent")) {
      return consentStatus === 200
        ? Response.json({ redirect: true, url: "#oauth-client-return" })
        : Response.json(
            { error: "invalid_signature", message: "private provider detail" },
            { status: consentStatus }
          );
    }
    if (path.endsWith("/sign-in/email") || path.endsWith("/sign-up/email")) {
      return Response.json({ redirect: true, url: "#oauth-consent-return" });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const auth = makeAuthClient(
    transport,
    undefined,
    "https://meal.test/api/auth"
  );
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  clients.push(queryClient);
  const root = createRootRoute({ component: Outlet });
  const routeTree = root.addChildren([
    createRoute({
      component: () => <h1>Workspace</h1>,
      getParentRoute: () => root,
      path: "/",
    }),
    createRoute({
      component: () => (
        <OAuthConsentPage
          request={parseAuthorizationRequest(
            useRouter().history.location.search
          )}
        />
      ),
      getParentRoute: () => root,
      path: "/oauth/consent",
    }),
    createRoute({
      component: LoginRoute.options.component ?? Outlet,
      getParentRoute: () => root,
      path: "/login",
      validateSearch: decodeAuthEntrySearch,
    }),
    createRoute({
      component: SignupRoute.options.component ?? Outlet,
      getParentRoute: () => root,
      path: "/signup",
      validateSearch: decodeAuthEntrySearch,
    }),
  ]);
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [entry] }),
    routeTree,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthClientContext value={auth}>
        <RouterProvider router={router} />
      </AuthClientContext>
    </QueryClientProvider>
  );
  await screen.findByRole("heading", { level: 1 });
  return { requests, router, user: userEvent.setup() };
};

it("shows the requested permissions, account and an honest client identity without following metadata URLs", async () => {
  await setup({ clientName: "ChatGPT" });
  expect(await screen.findByText("ChatGPT")).toBeInTheDocument();
  expect(
    screen.getByText(/Identity not verified by Meal Planner/u)
  ).toBeInTheDocument();
  expect(screen.getByText("cook@example.com")).toBeInTheDocument();
  expect(
    screen.getByText(/Read and change your own private/u)
  ).toBeInTheDocument();
  expect(screen.getByText(/Keep this connection active/u)).toBeInTheDocument();
  expect(
    screen.queryByText(/Add and change household people/u)
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /untrusted metadata/u })
  ).not.toBeInTheDocument();
});

it.each([
  { accept: true, label: "Allow access" },
  { accept: false, label: "Deny" },
])(
  "sends explicit $label through native consent with the original query and displayed account",
  async ({ label, accept }) => {
    const { requests, user } = await setup();
    await user.click(await screen.findByRole("button", { name: label }));
    await screen.findByText("Returning to the app…");
    expect(
      requests.filter((request) => request.path.endsWith("/oauth2/consent"))
    ).toEqual([
      {
        body: { accept, oauth_query: signedQuery },
        path: "/api/auth/oauth2/consent",
        user: "adult-1",
      },
    ]);
    expect(window.location.hash).toBe("#oauth-client-return");
    expect(screen.getByRole("button", { name: "Allow access" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
  }
);

it.each([{ metadataStatus: 401 }, { responseClientId: "different-client" }])(
  "does not offer a grant when signed metadata validation fails",
  async (options) => {
    const { requests } = await setup(options);
    await screen.findByRole("heading", {
      name: "This connection request is unavailable",
    });
    expect(
      screen.queryByRole("button", { name: "Allow access" })
    ).not.toBeInTheDocument();
    expect(
      requests.some((request) => request.path.endsWith("/oauth2/consent"))
    ).toBe(false);
    expect(
      screen.queryByText("private provider detail")
    ).not.toBeInTheDocument();
  }
);

it("blocks unknown permissions while allowing the user to deny", async () => {
  const { user, requests } = await setup({
    entry: `/oauth/consent${signedQuery.replace("meal-planner%3Aread", "unknown%3Apermission")}`,
  });
  expect(
    await screen.findByText("Unrecognised permission: unknown:permission")
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Allow access" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Deny" }));
  await screen.findByText("Returning to the app…");
  expect(
    requests.filter((request) => request.path.endsWith("/oauth2/consent"))
  ).toHaveLength(1);
});

it("does not retry an uncertain consent result or reveal provider error text", async () => {
  const { user, requests } = await setup({ consentStatus: 503 });
  await user.click(await screen.findByRole("button", { name: "Allow access" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn’t confirm your choice"
  );
  expect(screen.getByRole("button", { name: "Allow access" })).toBeDisabled();
  expect(
    requests.filter((request) => request.path.endsWith("/oauth2/consent"))
  ).toHaveLength(1);
  expect(screen.queryByText("private provider detail")).not.toBeInTheDocument();
});

it("returns an expired browser session through local login with the original consent request", async () => {
  const { router, requests } = await setup({ authenticated: false });
  await screen.findByLabelText("Password");
  expect(router.state.location.pathname).toBe("/login");
  expect(router.state.location.search).toEqual({
    redirect: `/oauth/consent${signedQuery}`,
  });
  expect(
    requests.some((request) =>
      request.path.endsWith("/oauth2/public-client-prelogin")
    )
  ).toBe(false);
});

it("honors the provider login prompt for an existing session and lets the native redirect complete", async () => {
  const { router, user, requests } = await setup({
    entry: `/login${signedQuery}&prompt=login`,
  });
  await user.type(await screen.findByLabelText("Email"), "cook@example.com");
  await user.type(screen.getByLabelText("Password"), "existing-password");
  expect(
    screen.getByRole("link", { name: "Create an account" })
  ).toHaveAttribute("href", `/signup${signedQuery}&prompt=login`);
  await user.click(screen.getByRole("button", { name: "Log in" }));
  await waitFor(() =>
    expect(window.location.hash).toBe("#oauth-consent-return")
  );
  expect(
    requests.find((request) => request.path.endsWith("/sign-in/email"))?.body
  ).toEqual({
    email: "cook@example.com",
    oauth_query: `${signedQuery}&prompt=login`,
    password: "existing-password",
  });
  expect(router.state.location.pathname).toBe("/login");
  expect(
    screen.queryByRole("heading", { name: "Workspace" })
  ).not.toBeInTheDocument();
});
