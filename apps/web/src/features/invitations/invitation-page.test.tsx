import { SetupProgress, InvitationId } from "@meal-planner/household-api";
import type { InvitationView } from "@meal-planner/household-api";
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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { makeAuthClient } from "../auth/auth-client.js";
import { InvitationPage, InvitationPageForRoute } from "./invitation-page.js";

const save = vi.fn((_progress: SetupProgress) => Effect.void);
const logout = vi.fn(() => Effect.void);
let progress = Schema.decodeUnknownSync(SetupProgress)({
  checkpoint: { name: "Draft family", stage: "family-name" },
  status: "active",
});
vi.mock("../onboarding/setup-context.js", () => ({
  useSetup: () => ({
    auth: makeAuthClient(),
    logout,
    peopleEffectForFamily: () => ({
      completeAdultLink: vi.fn(() => Effect.void),
      list: () => Effect.succeed({ currentPersonId: "already-linked" }),
    }),
    progress,
    save,
    selectFamily: vi.fn(() => Effect.void),
    user: {
      email: "recipient@example.test",
      id: "recipient",
      name: "Recipient",
    },
  }),
}));
const original = { name: "Draft family", stage: "family-name" };
const checkpoint = {
  decision: "decline",
  invitationId: "synthetic-invite",
  linkMutationId: "synthetic-link",
  organizationId: "synthetic-family",
  returnCheckpoint: original,
  stage: "invitation-response",
};
type ReadStatus = InvitationView["status"] | "forbidden" | "unauthorized";
let readStatus: ReadStatus = "pending";
const fetchInvitation = vi.fn<typeof fetch>(async () => {
  if (readStatus === "forbidden") {
    return Response.json(
      { _tag: "InvitationReadForbidden", message: "Another account." },
      { status: 403 }
    );
  }
  if (readStatus === "unauthorized") {
    return Response.json(
      { _tag: "InvitationReadUnauthorized", message: "Sign in." },
      { status: 401 }
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
const setup = async (status: ReadStatus) => {
  readStatus = status;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    component: () => (
      <InvitationPage
        invitationId={Schema.decodeUnknownSync(InvitationId)(
          "synthetic-invite"
        )}
      />
    ),
    getParentRoute: () => root,
    path: "/",
  });
  const next = createRoute({
    component: () => <h1>Saved destination</h1>,
    getParentRoute: () => root,
    path: "/setup",
  });
  const saved = createRoute({
    component: () => <h1>Saved setup</h1>,
    getParentRoute: () => root,
    path: "/setup/saved",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: root.addChildren([route, next, saved]),
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
  let heading = "This invitation is no longer available";
  if (status === "accepted") {
    heading = "This invitation was accepted";
  } else if (status === "pending") {
    heading = "Finish declining your invitation";
  } else if (status === "forbidden") {
    heading = "Use the invited email";
  } else if (status === "unauthorized") {
    heading = "Your account changed";
  }
  await screen.findByRole("heading", { name: heading });
  const [input, init] = fetchInvitation.mock.calls.at(-1) ?? [];
  if (!input) {
    throw new Error("Expected the invitation request");
  }
  const request = new Request(input, init);
  expect(new URL(request.url).pathname).toBe(
    "/v1/setup/invitation/synthetic-invite"
  );
  expect(request.headers.get("x-meal-planner-user")).toBe("recipient");
  return userEvent.setup();
};
beforeEach(() => {
  vi.stubGlobal("fetch", fetchInvitation);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("shows the unavailable invitation without loading an invalid route ID", () => {
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  render(<InvitationPageForRoute invitationId="invalid invitation" />);
  expect(
    screen.getByRole("heading", {
      name: "This invitation is no longer available",
    })
  ).toBeInTheDocument();
  expect(fetchInvitation).not.toHaveBeenCalled();
});
it("explains a recipient mismatch without revealing the invitation", async () => {
  progress = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint: { name: "Draft family", stage: "family-name" },
    status: "active",
  });
  const user = await setup("forbidden");
  expect(
    screen.getByText("Switch to the account that received the invitation.")
  ).toBeInTheDocument();
  expect(screen.queryByText("Synthetic family")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Switch account" }));
  expect(logout).toHaveBeenCalled();
});
it("saves the same invitation response when exiting setup", async () => {
  progress = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint,
    status: "active",
  });
  const user = await setup("pending");
  await user.click(screen.getByRole("button", { name: "Save & exit" }));
  expect(save).toHaveBeenCalledWith({ checkpoint, status: "paused" });
  expect(
    await screen.findByRole("heading", { name: "Saved setup" })
  ).toBeInTheDocument();
});
it("restores the full previous draft when a saved invitation expires", async () => {
  progress = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint,
    status: "active",
  });
  const user = await setup("expired");
  await user.click(
    screen.getByRole("button", { name: "Back to your account" })
  );
  expect(
    await screen.findByRole("heading", { name: "Saved destination" })
  ).toBeInTheDocument();
  expect(save).toHaveBeenCalledWith(
    { checkpoint: original, status: "active" },
    checkpoint.linkMutationId
  );
});
it("offers an explicit linking decision when another tab accepted a saved decline", async () => {
  progress = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint,
    status: "active",
  });
  const user = await setup("accepted");
  expect(save).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Finish joining family" })
  );
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      checkpoint: {
        invitationId: checkpoint.invitationId,
        linkMutationId: checkpoint.linkMutationId,
        organizationId: checkpoint.organizationId,
        returnCheckpoint: original,
        stage: "invitation-link",
      },
      status: "active",
    })
  );
});
