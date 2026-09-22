import { SetupProgress, InvitationView } from "@meal-planner/household-api";
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
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";

import { makeAuthClient } from "../auth/auth-client.js";
import { completeInvitation, readInvitation } from "./invitation-operations.js";
import { InvitationPage } from "./invitation-page.js";

vi.mock("./invitation-operations.js", () => ({
  completeInvitation: vi.fn(),
  readInvitation: vi.fn(),
}));
const save = vi.fn(async (_progress: SetupProgress) => {
  await Promise.resolve();
});
let progress = Schema.decodeUnknownSync(SetupProgress)({
  checkpoint: { name: "Draft family", stage: "family-name" },
  status: "active",
});
vi.mock("../onboarding/setup-context.js", () => ({
  useSetup: () => ({
    auth: makeAuthClient(),
    logout: vi.fn(),
    peopleForFamily: vi.fn(),
    progress,
    save,
    selectFamily: vi.fn(),
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
const setup = async (status: InvitationView["status"]) => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
  vi.mocked(readInvitation).mockResolvedValue(
    Schema.decodeUnknownSync(InvitationView)({
      email: "recipient@example.test",
      familyName: "Synthetic family",
      id: "synthetic-invite",
      inviterName: "Alex",
      organizationId: "synthetic-family",
      status,
    })
  );
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    component: () => <InvitationPage invitationId="synthetic-invite" />,
    getParentRoute: () => root,
    path: "/",
  });
  const next = createRoute({
    component: () => <h1>Saved destination</h1>,
    getParentRoute: () => root,
    path: "/setup",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: root.addChildren([route, next]),
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
  await screen.findByRole("heading", {
    name:
      status === "accepted"
        ? "This invitation was accepted"
        : "This invitation is no longer available",
  });
  return userEvent.setup();
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
  expect(save).toHaveBeenCalledWith({ checkpoint: original, status: "active" });
  expect(completeInvitation).not.toHaveBeenCalled();
});
it("offers an explicit linking decision when another tab accepted a saved decline", async () => {
  progress = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint,
    status: "active",
  });
  const user = await setup("accepted");
  expect(completeInvitation).not.toHaveBeenCalled();
  vi.mocked(completeInvitation).mockResolvedValue("joined");
  await user.click(
    screen.getByRole("button", { name: "Finish joining family" })
  );
  expect(save).toHaveBeenCalledWith({
    checkpoint: {
      invitationId: checkpoint.invitationId,
      linkMutationId: checkpoint.linkMutationId,
      organizationId: checkpoint.organizationId,
      returnCheckpoint: original,
      stage: "invitation-link",
    },
    status: "active",
  });
});
