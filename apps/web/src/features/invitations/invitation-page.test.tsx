// @vitest-environment jsdom
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
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { InvitationPage, InvitationPageForRoute } from "./invitation-page.js";

const logout = vi.fn(() => Effect.void);
const selectFamily = vi.fn(() => Effect.void);
vi.mock("../auth/index.js", () => ({
  useAccount: () => ({
    logout,
    user: {
      email: "recipient@example.test",
      id: "recipient",
      name: "Recipient",
    },
  }),
}));
vi.mock("../family/index.js", () => ({
  useFamilyActions: () => ({ refresh: async () => {}, selectFamily }),
}));
type ReadStatus = InvitationView["status"] | "forbidden" | "unauthorized";
let readStatus: ReadStatus = "pending";
let failResponse = false;
const responses: unknown[] = [];
const fetchInvitation = vi.fn<typeof fetch>(async (input, init) => {
  const request = new Request(input, init);
  const path = new URL(request.url).pathname;
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
    readStatus = body.decision === "accept" ? "accepted" : "rejected";
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
});
class TestIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}
const setup = async () => {
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: root.addChildren([
      createRoute({
        component: () => (
          <InvitationPage
            invitationId={Schema.decodeUnknownSync(InvitationId)(
              "synthetic-invite"
            )}
          />
        ),
        getParentRoute: () => root,
        path: "/",
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
      <RouterProvider router={router} />
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
  responses.length = 0;
  readStatus = "pending";
  failResponse = false;
  vi.stubGlobal("fetch", fetchInvitation);
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
  expect(fetchInvitation).not.toHaveBeenCalled();
});
it("explains a recipient mismatch without revealing the invitation", async () => {
  readStatus = "forbidden";
  const user = await setup();
  await screen.findByRole("heading", { name: "Use the invited email" });
  expect(screen.queryByText("Synthetic family")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Switch account" }));
  await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  expect(responses).toHaveLength(0);
});
it("joins through one generated server operation after explicit consent", async () => {
  const user = await setup();
  await screen.findByRole("heading", { name: "Join Synthetic family" });
  expect(responses).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Join family" }));
  await screen.findByRole("heading", { name: "Your account" });
  expect(responses).toEqual([
    { decision: "accept", mutationId: expect.any(String) },
  ]);
  expect(selectFamily).toHaveBeenCalledWith("synthetic-family");
  await waitFor(() => expect(localStorage.length).toBe(0));
});
it("retries an uncertain acceptance after reload with its original key", async () => {
  failResponse = true;
  const user = await setup();
  await user.click(await screen.findByRole("button", { name: "Join family" }));
  await waitFor(() => expect(responses).toHaveLength(3), { timeout: 3000 });
  await screen.findByRole("button", { name: "Continue" });
  const [first] = responses;
  cleanup();
  failResponse = false;
  const resumed = await setup();
  await resumed.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Your account" });
  expect(responses.at(-1)).toEqual(first);
});
it("does not turn a saved decline into acceptance when another tab accepted", async () => {
  readStatus = "accepted";
  localStorage.setItem(
    "meal-planner:request:recipient:invitation:synthetic-invite:saved-decline",
    JSON.stringify({ decision: "decline", mutationId: "saved-decline" })
  );
  const user = await setup();
  await screen.findByRole("heading", { name: "This invitation was accepted" });
  expect(responses).toHaveLength(0);
  await user.click(
    screen.getByRole("button", {
      name: "Continue with the accepted invitation",
    })
  );
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Your account" });
  expect(responses).toEqual([
    {
      decision: "accept",
      mutationId: expect.not.stringMatching(/^saved-decline$/u),
    },
  ]);
});
