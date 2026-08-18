// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthBoundary, householdSlug } from "./auth-boundary.js";
import type {
  AuthBoundaryActions,
  AuthBoundaryState,
} from "./auth-boundary.js";

afterEach(cleanup);

const makeActions = (): AuthBoundaryActions => ({
  createHousehold: vi.fn(async () => {}),
  retry: vi.fn(async () => {}),
  selectHousehold: vi.fn(async () => {}),
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  signUp: vi.fn(async () => {}),
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

  it("submits an email/password login", async () => {
    const actions = renderBoundary({ kind: "anonymous" });
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Email", { selector: "#login-email" }),
      "cook@example.com"
    );
    await user.type(
      screen.getByLabelText("Password", { selector: "#login-password" }),
      "correct-horse"
    );
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(actions.signIn).toHaveBeenCalledOnce());
    expect(vi.mocked(actions.signIn).mock.calls[0]?.[0]).toEqual({
      email: "cook@example.com",
      password: "correct-horse",
    });
  });

  it("creates an email/password account", async () => {
    const actions = renderBoundary({ kind: "anonymous" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Name"), "Cillian");
    await user.type(
      screen.getByLabelText("Email", { selector: "#signup-email" }),
      "new@example.com"
    );
    await user.type(
      screen.getByLabelText("Password", { selector: "#signup-password" }),
      "correct-horse"
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(actions.signUp).toHaveBeenCalledOnce());
    expect(vi.mocked(actions.signUp).mock.calls[0]?.[0]).toEqual({
      email: "new@example.com",
      name: "Cillian",
      password: "correct-horse",
    });
  });

  it("offers existing households and creates a new one", async () => {
    const actions = renderBoundary({
      activeHousehold: null,
      households: [{ id: "org-1", name: "Barron home", slug: "barron-home" }],
      kind: "authenticated",
      user: { email: "cook@example.com", name: "Cillian" },
    });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Continue to Barron home" })
    );
    expect(vi.mocked(actions.selectHousehold).mock.calls[0]?.[0]).toBe("org-1");

    const name = screen.getByLabelText("Household name");
    await user.clear(name);
    await user.type(name, "Sunday Cooks");
    await user.click(screen.getByRole("button", { name: "Create household" }));

    await waitFor(() => expect(actions.createHousehold).toHaveBeenCalledOnce());
    expect(vi.mocked(actions.createHousehold).mock.calls[0]?.[0]).toEqual({
      name: "Sunday Cooks",
      slug: expect.stringMatching(/^sunday-cooks-[a-z0-9-]{8}$/u),
    });
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

describe("householdSlug", () => {
  it("produces a bounded URL-safe Better Auth organization slug", () => {
    expect(householdSlug("  Lou & Cillian's Home  ", "A1B2C3D4")).toBe(
      "lou-cillian-s-home-a1b2c3d4"
    );
  });
});
