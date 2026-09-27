// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AuthClientContext, makeAuthClient } from "../auth/auth-client.js";
import { InvitationPageForRoute } from "./invitation-page.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("opens an invitation using account identity without loading a family or onboarding provider", async () => {
  const paths: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    paths.push(url.pathname);
    if (url.pathname.endsWith("/get-session")) {
      return Response.json({
        session: {
          activeOrganizationId: null,
          expiresAt: "2099-01-01T00:00:00Z",
          id: "session-invitation",
          userId: "recipient",
        },
        user: {
          email: "recipient@example.test",
          id: "recipient",
          name: "Recipient",
        },
      });
    }
    if (url.pathname === "/v1/invitations/invitation-account-test") {
      return Response.json({
        email: "recipient@example.test",
        familyName: "Invited family",
        id: "invitation-account-test",
        inviterName: "Owner",
        organizationId: "family-test",
        status: "pending",
      });
    }
    throw new Error(`Unexpected dependency: ${url.pathname}`);
  };
  vi.stubGlobal("fetch", transport);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
  vi.stubGlobal("scrollTo", () => {});
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: root.addChildren([
      createRoute({
        component: () => (
          <InvitationPageForRoute invitationId="invitation-account-test" />
        ),
        getParentRoute: () => root,
        path: "/",
      }),
    ]),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthClientContext value={makeAuthClient(transport)}>
        <RouterProvider router={router} />
      </AuthClientContext>
    </QueryClientProvider>
  );
  await screen.findByRole("button", { name: "Join family" });
  expect(paths.some((value) => value.startsWith("/v1/families"))).toBe(false);
  expect(paths).toContain("/v1/invitations/invitation-account-test");
  queryClient.clear();
});
