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
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Route as RecoveryRoute } from "@/routes/forgot-password.js";
import { Route as LoginRoute } from "@/routes/login.js";
import { Route as SignupRoute } from "@/routes/signup.js";

import { AuthBoundary } from "./auth-boundary.js";
import {
  AuthClientContext,
  makeAuthClient,
  useAuthClient,
} from "./auth-client.js";
import { parseSignIn, parseSignUp } from "./auth-input.js";
import { decodeAuthSearch } from "./auth-navigation.js";
import { deriveAuthBoundaryState } from "./auth-state.js";

const makeTransport = (initiallyAuthenticated = false) => {
  let authenticated = initiallyAuthenticated;
  const requests: string[] = [];
  const submissions: { email: string; password: string; name?: string }[] = [];
  const household = {
    id: "household-1",
    members: [],
    name: "Test family",
    slug: "test-family",
  };
  const account = {
    session: {
      expiresAt: "2099-01-01T00:00:00Z",
      id: "session-1",
      userId: "adult-1",
    },
    user: { email: "cook@example.com", id: "adult-1", name: "Cook" },
  };
  const fixture: {
    reply: (() => Promise<Response>) | null;
    requests: string[];
    submissions: typeof submissions;
    transport: typeof fetch;
  } = {
    reply: null,
    requests,
    submissions,
    transport: async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path.endsWith("/sign-in/email") || path.endsWith("/sign-up/email")) {
        const body: unknown = await request.json();
        submissions.push(
          path.endsWith("/sign-up/email")
            ? parseSignUp(body)
            : parseSignIn(body)
        );
        if (fixture.reply !== null) {
          return fixture.reply();
        }
        authenticated = true;
        return Response.json(account);
      }
      if (path.endsWith("/get-session")) {
        return Response.json(authenticated ? account : null);
      }
      if (!authenticated) {
        return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
      }
      if (path.endsWith("/organization/list")) {
        return Response.json([household]);
      }
      if (path.endsWith("/organization/get-full-organization")) {
        return Response.json(household);
      }
      throw new Error(`Unexpected auth fixture path: ${path}`);
    },
  };
  return fixture;
};

// The protected destination exercises the real session/organization projection;
// recipe and household feature rendering is covered by their own suites.
const unused = async () => {
  throw new Error("Unexpected household mutation");
};

const TestWorkspace = () => {
  const client = useAuthClient();
  const state = deriveAuthBoundaryState({
    activeOrganization: client.useActiveOrganization(),
    organizations: client.useListOrganizations(),
    session: client.useSession(),
  });

  return (
    <AuthBoundary
      actions={{
        createHousehold: unused,
        retry: unused,
        selectHousehold: unused,
        signOut: unused,
      }}
      state={state}
    >
      {() => <p>Authenticated workspace</p>}
    </AuthBoundary>
  );
};

const setup = async (
  entry = "/login",
  fixture = makeTransport(),
  authenticated = false
) => {
  const client = makeAuthClient(fixture.transport);
  const root = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({
      component: TestWorkspace,
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
      <AuthClientContext value={client}>
        <RouterProvider router={router} />
      </AuthClientContext>
    </QueryClientProvider>
  );
  await (authenticated
    ? screen.findByText("Authenticated workspace")
    : screen.findByRole("heading"));
  return { fixture, router, user: userEvent.setup() };
};
const fillCredentials = async (
  user: ReturnType<typeof userEvent.setup>,
  password = "correct-horse"
) => {
  await user.type(screen.getByLabelText("Email"), "cook@example.com");
  await user.type(screen.getByLabelText("Password"), password);
};
beforeEach(() => {
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
    const { user, fixture } = await setup(`/${kind}`);
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
    expect(fixture.requests).toContain("/api/auth/organization/list");
    expect(fixture.requests).toContain(
      "/api/auth/organization/get-full-organization"
    );
    if (kind === "signup") {
      expect(fixture.submissions[0]?.name).toBe("Cook");
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
  await user.click(screen.getByRole("link", { name: "Log in" }));
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
  const { user, fixture } = await setup("/signup");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Email"), "bad");
  expect(
    screen.queryByText("Enter a valid email address.")
  ).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(screen.getByLabelText("Your name")).toHaveFocus());
  expect(fixture.submissions).toHaveLength(0);
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

it.each([
  { path: "/login", submit: "Log in" },
  { path: "/signup", submit: "Create account" },
])(
  "shows only the applicable email error on $path",
  async ({ path, submit }) => {
    const { user, fixture } = await setup(path);
    await user.click(screen.getByRole("button", { name: submit }));
    expect(screen.getAllByText("Enter your email.")).toHaveLength(1);
    expect(
      screen.queryByText("Enter a valid email address.")
    ).not.toBeInTheDocument();
    if (path === "/signup") {
      expect(screen.getByText("Create a password.")).toBeInTheDocument();
      expect(
        screen.queryByText("Use at least 8 characters.")
      ).not.toBeInTheDocument();
      await user.type(screen.getByLabelText("Password"), "short");
      expect(screen.queryByText("Create a password.")).not.toBeInTheDocument();
      expect(
        screen.getByText("Use at least 8 characters.")
      ).toBeInTheDocument();
    }
    const email = screen.getByLabelText("Email");
    await user.type(email, "   ");
    expect(screen.getAllByText("Enter your email.")).toHaveLength(1);
    expect(
      screen.queryByText("Enter a valid email address.")
    ).not.toBeInTheDocument();
    await user.clear(email);
    await user.type(email, "bad");
    expect(screen.queryByText("Enter your email.")).not.toBeInTheDocument();
    expect(screen.getAllByText("Enter a valid email address.")).toHaveLength(1);
    await user.clear(email);
    await user.type(email, "cook@example.com");
    expect(screen.queryByText("Enter your email.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Enter a valid email address.")
    ).not.toBeInTheDocument();
    expect(fixture.submissions).toHaveLength(0);
  }
);

it("allows short existing passwords, preserves rejected credentials, and toggles visibility", async () => {
  const fixture = makeTransport();
  fixture.reply = async () =>
    Response.json(
      { code: "INVALID_EMAIL_OR_PASSWORD", message: "private server detail" },
      { status: 401 }
    );
  const { user } = await setup("/login", fixture);
  await fillCredentials(user, "short");
  await user.click(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  expect(fixture.submissions).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await user.keyboard("{Enter}");
  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  expect(fixture.submissions).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Log in" }));
  expect(
    await screen.findByText(/Email or password doesn’t match/u)
  ).toBeInTheDocument();
  expect(screen.queryByText("private server detail")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toHaveValue("short");
  expect(fixture.submissions[0]?.password).toBe("short");
});

it("maps duplicate accounts to the email field without exposing raw errors", async () => {
  const fixture = makeTransport();
  fixture.reply = async () =>
    Response.json(
      {
        code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
        message: "private detail",
      },
      { status: 422 }
    );
  const { user } = await setup("/signup", fixture);
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
  let settle: ((value: Response) => void) | undefined;
  const fixture = makeTransport();
  fixture.reply = () =>
    new Promise((resolve) => {
      settle = resolve;
    });
  const { user } = await setup("/signup", fixture);
  await user.type(screen.getByLabelText("Your name"), "Cook");
  await fillCredentials(user);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(
    screen.getByRole("button", { name: "Creating account…" })
  ).toBeDisabled();
  expect(screen.getByLabelText("Email")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Show password" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
    "aria-disabled",
    "true"
  );
  settle?.(
    Response.json({ code: "FAILED_TO_CREATE_SESSION" }, { status: 400 })
  );
  expect(
    await screen.findByText(/Your account may be ready/u)
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
});

it("honors the response retry header and re-enables login after the wait", async () => {
  const fixture = makeTransport();
  fixture.reply = async () =>
    Response.json(
      { code: "TOO_MANY_REQUESTS" },
      { headers: { "X-Retry-After": "1" }, status: 429 }
    );
  const { user } = await setup("/login", fixture);
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
  const { router, fixture } = await setup(
    "/login?redirect=%2F%3FintentId%3Dpreserved-intent",
    makeTransport(true),
    true
  );
  expect(router.state.location.pathname).toBe("/");
  expect(router.state.location.search).toEqual({
    intentId: "preserved-intent",
  });
  expect(fixture.submissions).toHaveLength(0);
});
