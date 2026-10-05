import { InvitationId } from "@meal-planner/household-api";
import type { InvitationView } from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ApiRuntimeContext } from "../api-client/index.js";
import {
  AccountProvider,
  AuthClientContext,
  makeAuthClient,
} from "../auth/index.js";
import { decodeWorkspaceSearch } from "../meal-workspace/index.js";
import { InvitationPage, InvitationPageForRoute } from "./invitation-page.js";

let logoutCalls = 0;
const selectedFamilies: string[] = [];
let signedOut = false;
type ReadStatus = InvitationView["status"] | "forbidden" | "unauthorized";
let readStatus: ReadStatus = "pending";
let failResponse = false;
let commitResponse = true;
const responses: unknown[] = [];
const requestedPaths: string[] = [];
const fetchInvitation: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const path = new URL(request.url).pathname;
  requestedPaths.push(path);
  if (path.endsWith("/get-session")) {
    return Response.json(
      signedOut
        ? null
        : {
            session: { activeOrganizationId: selectedFamilies.at(-1) ?? null },
            user: {
              email: "recipient@example.test",
              id: "recipient",
              name: "Recipient",
            },
          }
    );
  }
  if (path.endsWith("/sign-out")) {
    signedOut = true;
    logoutCalls += 1;
    return Response.json({ success: true });
  }
  if (path.endsWith("/organization/set-active")) {
    const body = await request.json();
    selectedFamilies.push(body.organizationId);
    return Response.json({ id: body.organizationId });
  }
  expect(request.headers.get("x-meal-planner-user")).toBe("recipient");
  if (
    path === "/v1/invitations/synthetic-invite/response" &&
    request.method === "POST"
  ) {
    const body = (await request.json()) as {
      decision: "accept" | "decline";
      mutationId: string;
    };
    responses.push(body);
    if (!failResponse || commitResponse) {
      readStatus = body.decision === "accept" ? "accepted" : "rejected";
    }
    if (failResponse) {
      return Response.json(
        { _tag: "InvitationReadUnavailable", message: "Unknown result" },
        { status: 503 }
      );
    }
    return Response.json({
      familyId: "synthetic-family",
      status: body.decision === "accept" ? "joined" : "declined",
    });
  }
  expect(path).toBe("/v1/invitations/synthetic-invite");
  if (readStatus === "forbidden" || readStatus === "unauthorized") {
    return Response.json(
      {
        _tag:
          readStatus === "forbidden"
            ? "InvitationReadForbidden"
            : "InvitationReadUnauthorized",
        message: "No access",
      },
      { status: readStatus === "forbidden" ? 403 : 401 }
    );
  }
  return Response.json({
    email: "recipient@example.test",
    familyName: "Synthetic family",
    id: "synthetic-invite",
    inviterName: "Alex",
    organizationId: "synthetic-family",
    status: readStatus,
  });
};
class TestIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}
const setup = async () => {
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    history: createMemoryHistory({
      initialEntries: ["/invitation/synthetic-invite"],
    }),
    routeTree: root.addChildren([
      createRoute({
        component: () => <h1>Log in</h1>,
        getParentRoute: () => root,
        path: "/login",
      }),
      createRoute({
        component: () => <h1>Your family workspace</h1>,
        getParentRoute: () => root,
        path: "/",
        validateSearch: decodeWorkspaceSearch,
      }),
      createRoute({
        component: () => (
          <AccountProvider>
            <InvitationPage
              invitationId={Schema.decodeUnknownSync(InvitationId)(
                "synthetic-invite"
              )}
            />
          </AccountProvider>
        ),
        getParentRoute: () => root,
        path: "/invitation/$invitationId",
      }),
      createRoute({
        component: () => <h1>Your account</h1>,
        getParentRoute: () => root,
        path: "/setup",
      }),
    ]),
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false },
          },
        })
      }
    >
      <AuthClientContext value={makeAuthClient(fetchInvitation)}>
        <ApiRuntimeContext
          value={{ baseUrl: window.location.origin, fetch: fetchInvitation }}
        >
          <RouterProvider router={router} />
        </ApiRuntimeContext>
      </AuthClientContext>
    </QueryClientProvider>
  );
  await waitFor(() =>
    expect(
      screen.queryByText("Loading your invitation…")
    ).not.toBeInTheDocument()
  );
  return userEvent.setup();
};
beforeEach(() => {
  localStorage.clear();
  signedOut = false;
  logoutCalls = 0;
  selectedFamilies.length = 0;
  responses.length = 0;
  requestedPaths.length = 0;
  readStatus = "pending";
  failResponse = false;
  commitResponse = true;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("rejects an invalid route identity without loading recipient data", () => {
  render(<InvitationPageForRoute invitationId="invalid invitation" />);
  expect(
    screen.getByRole("heading", {
      name: "This invitation is no longer available",
    })
  ).toBeInTheDocument();
  expect(requestedPaths).toHaveLength(0);
});
it("explains a recipient mismatch without revealing the invitation", async () => {
  readStatus = "forbidden";
  const user = await setup();
  await screen.findByRole("heading", { name: "Use the invited email" });
  expect(screen.queryByText("Synthetic family")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Switch account" }));
  await waitFor(() => expect(logoutCalls).toBe(1));
  expect(responses).toHaveLength(0);
});
it("joins through one generated server operation after explicit consent", async () => {
  const user = await setup();
  await screen.findByRole("heading", { name: "Join Synthetic family" });
  expect(responses).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Join family" }));
  await screen.findByRole("heading", { name: "Your family workspace" });
  expect(responses).toEqual([
    { decision: "accept", mutationId: expect.any(String) },
  ]);
  expect(selectedFamilies).toEqual(["synthetic-family"]);
  await waitFor(() => expect(localStorage.length).toBe(0));
});
it("retries an uncertain acceptance on the mounted screen with its original key", async () => {
  failResponse = true;
  const user = await setup();
  await user.click(await screen.findByRole("button", { name: "Join family" }));
  await waitFor(() => expect(responses).toHaveLength(3), { timeout: 3000 });
  await screen.findByRole("button", { name: "Continue" });
  const [first] = responses;
  failResponse = false;
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Your family workspace" });
  expect(responses.at(-1)).toEqual(first);
});
it("reads the accepted state after reload without replaying a browser mutation", async () => {
  failResponse = true;
  const user = await setup();
  await user.click(await screen.findByRole("button", { name: "Join family" }));
  await waitFor(() => expect(responses).toHaveLength(3), { timeout: 3000 });
  await screen.findByRole("button", { name: "Continue" });
  expect(localStorage.length).toBe(0);
  cleanup();
  failResponse = false;
  await setup();
  await screen.findByRole("button", { name: "Continue" });
  expect(responses).toHaveLength(3);
});
it("keeps an uncertain decline as a decline when retrying", async () => {
  failResponse = true;
  commitResponse = false;
  const user = await setup();
  await user.click(
    await screen.findByRole("button", { name: "Decline invitation" })
  );
  await waitFor(() => expect(responses).toHaveLength(3), { timeout: 3000 });
  const [first] = responses;
  failResponse = false;
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await waitFor(() => expect(responses).toHaveLength(4));
  await screen.findByRole("heading", { name: "Your account" });
  expect(responses.at(-1)).toEqual(first);
  expect(first).toMatchObject({ decision: "decline" });
});
