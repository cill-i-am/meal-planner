// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as RouterModule from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type * as AuthClientModule from "../features/auth/auth-client.js";
import { Route } from "./index.js";

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  useActiveOrganization: vi.fn(),
  useListOrganizations: vi.fn(),
  useSession: vi.fn(),
}));
vi.mock("../features/auth/auth-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthClientModule>()),
  authClient: client,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useSearch: () => ({}),
}));
vi.mock("../features/recipe-import/recipe-import-page.js", () => ({
  RecipeImportPage: ({ householdName }: { readonly householdName: string }) => (
    <p>Active household: {householdName}</p>
  ),
}));

interface QuerySnapshot<T> {
  readonly data: T | null;
  readonly error: { readonly status: number } | null;
  readonly isPending: boolean;
}
const queryStore = <T,>(initial: QuerySnapshot<T>, refreshed: T) => {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const refetch = vi.fn(async () => {
    snapshot = { data: refreshed, error: null, isPending: false };
    for (const listener of listeners) {
      listener();
    }
  });
  return {
    refetch,
    useQuery: function useQuery() {
      return { ...useSyncExternalStore(subscribe, () => snapshot), refetch };
    },
  };
};
const setup = () => {
  const household = {
    id: "household-1",
    members: [],
    name: "Test household",
    slug: "test-household",
  };
  const session = queryStore(
    { data: null, error: null, isPending: false },
    { user: { email: "cook@example.com", id: "adult-1", name: "Cook" } }
  );
  const organizations = queryStore(
    { data: null, error: { status: 401 }, isPending: false },
    [household]
  );
  const activeOrganization = queryStore(
    { data: null, error: { status: 401 }, isPending: false },
    household
  );
  client.useSession.mockImplementation(session.useQuery);
  client.useListOrganizations.mockImplementation(organizations.useQuery);
  client.useActiveOrganization.mockImplementation(activeOrganization.useQuery);
  const Component = Route.options.component;
  if (Component === undefined) {
    throw new Error("Expected route component");
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Component />
    </QueryClientProvider>
  );
  return { activeOrganization, organizations, session };
};
const submit = async (kind: "signIn" | "signUp") => {
  const user = userEvent.setup();
  const prefix = kind === "signIn" ? "login" : "signup";
  if (kind === "signUp") {
    await user.type(screen.getByLabelText("Name"), "Cook");
  }
  await user.type(
    screen.getByLabelText("Email", { selector: `#${prefix}-email` }),
    "cook@example.com"
  );
  await user.type(
    screen.getByLabelText("Password", { selector: `#${prefix}-password` }),
    "correct-horse"
  );
  await user.click(
    screen.getByRole("button", {
      name: kind === "signIn" ? "Log in" : "Create account",
    })
  );
};
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it.each(["signIn", "signUp"] as const)(
  "refreshes cached anonymous household errors after successful %s without a retry click",
  async (kind) => {
    client[kind].email.mockResolvedValue({
      data: { user: { id: "adult-1" } },
      error: null,
    });
    const queries = setup();
    expect(
      screen.getByRole("heading", { name: "Plan together at home" })
    ).toBeInTheDocument();
    await submit(kind);
    expect(
      await screen.findByText("Active household: Test household")
    ).toBeInTheDocument();
    expect(queries.organizations.refetch).toHaveBeenCalledOnce();
    expect(queries.activeOrganization.refetch).toHaveBeenCalledOnce();
    expect(queries.session.refetch).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument();
  }
);

it.each(["signIn", "signUp"] as const)(
  "preserves the authentication error and does not refresh household queries after failed %s",
  async (kind) => {
    client[kind].email.mockResolvedValue({
      data: null,
      error: { message: "Credentials were rejected." },
    });
    const queries = setup();
    await submit(kind);
    expect(
      await screen.findByText("Credentials were rejected.")
    ).toBeInTheDocument();
    expect(queries.organizations.refetch).not.toHaveBeenCalled();
    expect(queries.activeOrganization.refetch).not.toHaveBeenCalled();
    expect(queries.session.refetch).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Plan together at home" })
    ).toBeInTheDocument();
  }
);
