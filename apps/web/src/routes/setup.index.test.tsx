import { Family } from "@meal-planner/families";
import { UserId } from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { ApiRuntimeContext } from "../features/api-client/index.js";
import {
  accountKey,
  AuthClientContext,
  makeAuthClient,
} from "../features/auth/index.js";
import { familyKeys } from "../features/family/index.js";
import { decodeWorkspaceSearch } from "../features/meal-workspace/index.js";
import { SetupProvider } from "../features/onboarding/index.js";
import { SetupEntry } from "./setup.index.js";

const unexpectedFetch: typeof fetch = async () => {
  throw new Error("Cached account and family should be used.");
};

it("opens the workspace without setup search after a completed family's setup entry", async () => {
  const userId = Schema.decodeUnknownSync(UserId)("recipient");
  const family = Schema.decodeUnknownSync(Family)({
    canManage: false,
    createdAtEpochMs: 1,
    id: "synthetic-family",
    name: "Synthetic family",
    setup: { completedAtEpochMs: 2, status: "complete" },
    slug: "synthetic-family",
    updatedAtEpochMs: 2,
    version: 1,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(accountKey, {
    session: { activeOrganizationId: family.id },
    user: { email: "recipient@example.test", id: userId, name: "Recipient" },
  });
  queryClient.setQueryData(familyKeys.detail(userId, family.id), family);
  const root = createRootRoute({ component: Outlet });
  const setup = createRoute({
    component: () => (
      <SetupProvider>
        <Outlet />
      </SetupProvider>
    ),
    getParentRoute: () => root,
    path: "/setup",
    validateSearch: Schema.decodeUnknownSync(
      Schema.Struct({ familyId: Schema.optional(Schema.String) })
    ),
  });
  const router = createRouter({
    history: createMemoryHistory({
      initialEntries: [`/setup?familyId=${family.id}`],
    }),
    routeTree: root.addChildren([
      createRoute({
        component: () => <h1>Family workspace</h1>,
        getParentRoute: () => root,
        path: "/",
        validateSearch: decodeWorkspaceSearch,
      }),
      setup.addChildren([
        createRoute({
          component: SetupEntry,
          getParentRoute: () => setup,
          path: "/",
        }),
      ]),
    ]),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthClientContext value={makeAuthClient(unexpectedFetch)}>
        <ApiRuntimeContext
          value={{ baseUrl: window.location.origin, fetch: unexpectedFetch }}
        >
          <RouterProvider router={router} />
        </ApiRuntimeContext>
      </AuthClientContext>
    </QueryClientProvider>
  );

  await screen.findByRole("heading", { name: "Family workspace" });
  expect(router.state.location.pathname).toBe("/");
  expect(router.state.location.search).toEqual({});
});
