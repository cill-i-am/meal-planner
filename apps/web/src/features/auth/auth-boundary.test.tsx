// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthBoundary } from "./auth-boundary.js";
import type {
  AuthBoundaryActions,
  AuthBoundaryState,
} from "./auth-boundary.js";

afterEach(cleanup);

const makeActions = (): AuthBoundaryActions => ({
  retry: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
});

const renderBoundary = (
  state: AuthBoundaryState,
  actions: AuthBoundaryActions = makeActions()
) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthBoundary actions={actions} state={state}>
        {(household) => <p>Active: {household.name}</p>}
      </AuthBoundary>
    </QueryClientProvider>
  );
  return actions;
};

describe("AuthBoundary", () => {
  it("shows a safe retry action when authentication is unavailable", async () => {
    const actions = renderBoundary({ kind: "error" });
    const user = userEvent.setup();

    expect(
      screen.getByText("We couldn’t load your account right now.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(actions.retry).toHaveBeenCalledOnce();
  });

  it("renders the application only for an active household", () => {
    renderBoundary({
      activeHousehold: {
        id: "org-1",
        name: "Barron home",
        slug: "barron-home",
      },
      households: [],
      kind: "authenticated",
      user: { email: "cook@example.com", name: "Cillian" },
    });
    expect(screen.getByText("Active: Barron home")).toBeInTheDocument();
  });
});
