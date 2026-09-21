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
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Route as RecoveryRoute } from "../../routes/forgot-password.js";
import { Route as IndexRoute } from "../../routes/index.js";
import { Route as LoginRoute } from "../../routes/login.js";
import { Route as SignupRoute } from "../../routes/signup.js";
import { decodeAuthSearch } from "./auth-navigation.js";

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  useActiveOrganization: vi.fn(),
  useListOrganizations: vi.fn(),
  useSession: vi.fn(),
}));
vi.mock("better-auth/react", () => ({ createAuthClient: () => client }));
vi.mock("../recipe-import/recipe-import-page.js", () => ({
  RecipeImportPage: () => <p>Authenticated workspace</p>,
}));

interface QuerySnapshot<T> {
  data: T | null;
  error: { status: number } | null;
  isPending: boolean;
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
const setup = async (entry = "/login", authenticated = false) => {
  const household = {
    id: "household-1",
    members: [],
    name: "Test family",
    slug: "test-family",
  };
  const session = queryStore(
    {
      data: authenticated
        ? { user: { email: "cook@example.com", id: "adult-1", name: "Cook" } }
        : null,
      error: null,
      isPending: false,
    },
    { user: { email: "cook@example.com", id: "adult-1", name: "Cook" } }
  );
  const organizations = queryStore(
    {
      data: authenticated ? [household] : null,
      error: authenticated ? null : { status: 401 },
      isPending: false,
    },
    [household]
  );
  const activeOrganization = queryStore(
    {
      data: authenticated ? household : null,
      error: authenticated ? null : { status: 401 },
      isPending: false,
    },
    household
  );
  client.useSession.mockImplementation(session.useQuery);
  client.useListOrganizations.mockImplementation(organizations.useQuery);
  client.useActiveOrganization.mockImplementation(activeOrganization.useQuery);
  for (const route of [IndexRoute, LoginRoute, SignupRoute, RecoveryRoute]) {
    if (route.options.component === undefined) {
      throw new Error("Missing route component");
    }
  }
  const root = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({
      component: IndexRoute.options.component ?? Outlet,
      getParentRoute: () => root,
      path: "/",
    }),
    createRoute({
      component: LoginRoute.options.component ?? Outlet,
      getParentRoute: () => root,
      path: "/login",
      validateSearch: decodeAuthSearch,
    }),
    createRoute({
      component: SignupRoute.options.component ?? Outlet,
      getParentRoute: () => root,
      path: "/signup",
      validateSearch: decodeAuthSearch,
    }),
    createRoute({
      component: RecoveryRoute.options.component ?? Outlet,
      getParentRoute: () => root,
      path: "/forgot-password",
      validateSearch: decodeAuthSearch,
    }),
  ];
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [entry] }),
    routeTree: root.addChildren(routes),
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  await (authenticated
    ? screen.findByText("Authenticated workspace")
    : screen.findByRole("heading"));
  return {
    activeOrganization,
    organizations,
    router,
    session,
    user: userEvent.setup(),
  };
};
const fillCredentials = async (
  user: ReturnType<typeof userEvent.setup>,
  password = "correct-horse"
) => {
  await user.type(screen.getByLabelText("Email"), "cook@example.com");
  await user.type(screen.getByLabelText("Password"), password);
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["login", "signup"] as const)(
  "refreshes anonymous caches and returns to the workspace after %s",
  async (kind) => {
    client[kind === "login" ? "signIn" : "signUp"].email.mockResolvedValue({
      data: { user: { id: "adult-1" } },
      error: null,
    });
    const { user, organizations, activeOrganization, session } = await setup(
      `/${kind}`
    );
    if (kind === "signup") {
      await user.type(screen.getByLabelText("Your name"), "  Cook  ");
    }
    await fillCredentials(user);
    await user.click(
      screen.getByRole("button", {
        name: kind === "login" ? "Log in" : "Create account",
      })
    );
    expect(
      await screen.findByText("Authenticated workspace")
    ).toBeInTheDocument();
    expect(organizations.refetch).toHaveBeenCalledOnce();
    expect(activeOrganization.refetch).toHaveBeenCalledOnce();
    expect(session.refetch).toHaveBeenCalledOnce();
    if (kind === "signup") {
      expect(client.signUp.email.mock.calls[0]?.[0].name).toBe("Cook");
    }
  }
);

it("redirects anonymous home requests and keeps their destination across auth routes", async () => {
  const { router, user } = await setup("/?intentId=preserved-intent");
  expect(router.state.location.pathname).toBe("/login");
  await user.click(screen.getByRole("link", { name: "Create an account" }));
  expect(router.state.location.pathname).toBe("/signup");
  expect(router.state.location.search).toEqual({
    redirect: "/?intentId=preserved-intent",
  });
  await user.click(
    screen.getByRole("link", { name: /Already have an account/u })
  );
  await user.click(screen.getByRole("link", { name: "Forgot password?" }));
  expect(
    await screen.findByRole("heading", { name: "Password reset unavailable" })
  ).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Back to log in" }));
  expect(router.state.location.pathname).toBe("/login");
  expect(router.state.location.search).toEqual({
    redirect: "/?intentId=preserved-intent",
  });
});

it("validates on blur and submit, focuses the first invalid field, and clears corrected errors", async () => {
  const { user } = await setup("/signup");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Email"), "bad");
  expect(
    screen.queryByText("Enter a valid email address.")
  ).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(screen.getByLabelText("Your name")).toHaveFocus());
  expect(client.signUp.email).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Your name"), "Cook");
  await user.clear(screen.getByLabelText("Email"));
  await user.type(screen.getByLabelText("Email"), "cook@example.com");
  expect(
    screen.queryByText("Enter a valid email address.")
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toHaveAttribute(
    "aria-describedby",
    "signup-password-error"
  );
});

it("allows short existing passwords, preserves rejected credentials, and toggles visibility", async () => {
  client.signIn.email.mockResolvedValue({
    data: null,
    error: {
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "private server detail",
      status: 401,
    },
  });
  const { user, session } = await setup();
  await fillCredentials(user, "short");
  await user.click(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  await user.click(screen.getByRole("button", { name: "Log in" }));
  expect(
    await screen.findByText(/Email or password doesn’t match/u)
  ).toBeInTheDocument();
  expect(screen.queryByText("private server detail")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toHaveValue("short");
  expect(session.refetch).not.toHaveBeenCalled();
});

it("maps duplicate accounts to the email field without exposing raw errors", async () => {
  client.signUp.email.mockResolvedValue({
    data: null,
    error: {
      code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
      message: "private detail",
      status: 422,
    },
  });
  const { user } = await setup("/signup");
  await user.type(screen.getByLabelText("Your name"), "Cook");
  await fillCredentials(user);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(
    await screen.findByText(/An account already uses this email/u)
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
});

it("disables duplicate submits and sibling navigation while awaiting the server", async () => {
  let settle:
    | ((value: { data: null; error: { code: string } }) => void)
    | undefined;
  client.signUp.email.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      })
  );
  const { user } = await setup("/signup");
  await user.type(screen.getByLabelText("Your name"), "Cook");
  await fillCredentials(user);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(
    screen.getByRole("button", { name: "Creating account…" })
  ).toBeDisabled();
  expect(screen.getByLabelText("Email")).toBeDisabled();
  expect(
    screen.getByText(/Already have an account/u).closest("a")
  ).toHaveAttribute("aria-disabled", "true");
  settle?.({ data: null, error: { code: "FAILED_TO_CREATE_SESSION" } });
  expect(
    await screen.findByText(/Your account may be ready/u)
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
});

it("honors the response retry header and re-enables login after the wait", async () => {
  client.signIn.email.mockImplementation(async (_input, options) => {
    options.onError({
      response: new Response(null, {
        headers: { "X-Retry-After": "1" },
        status: 429,
      }),
    });
    return { data: null, error: { status: 429 } };
  });
  const { user } = await setup();
  await fillCredentials(user);
  await user.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByText(/Too many attempts/u)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  await waitFor(
    () => expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled(),
    { timeout: 2000 }
  );
});

it("returns an already signed-in account to its path and query without another login", async () => {
  const { router } = await setup(
    "/login?redirect=%2F%3FintentId%3Dpreserved-intent",
    true
  );
  expect(router.state.location.pathname).toBe("/");
  expect(router.state.location.search).toEqual({
    intentId: "preserved-intent",
  });
  expect(client.signIn.email).not.toHaveBeenCalled();
});
