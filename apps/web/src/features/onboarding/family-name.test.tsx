import { CreateFamily } from "@meal-planner/families";
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
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

import { ApiRuntimeContext, browserApiRuntime } from "../api-client/index.js";
import { AuthClientContext, makeAuthClient } from "../auth/auth-client.js";
import { FamilyNamePage } from "./family-name.js";
import { SetupProvider } from "./setup-provider.js";

let currentTransport: typeof fetch;
const makeTransport = () => {
  let family: object | null = null;
  let signedOut = false;
  let signOutCalls = 0;
  const createCalls: CreateFamily[] = [];
  const fixture = {
    createCalls,
    createError: null as null | {
      readonly _tag:
        | "FamilyUnauthorized"
        | "FamilyForbidden"
        | "FamilyInvalidInput"
        | "FamilyConflict"
        | "FamilyRateLimited"
        | "FamilyUnavailable";
      readonly status: number;
    },
    createReply: Promise.withResolvers<null>(),
    get signOutCalls() {
      return signOutCalls;
    },
    transport: (async (input, init): Promise<Response> => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/get-session")) {
        return Response.json(
          signedOut
            ? null
            : {
                session: {
                  activeOrganizationId: family ? "family-1" : null,
                  expiresAt: "2099-01-01T00:00:00Z",
                  id: "session-1",
                  userId: "adult-1",
                },
                user: {
                  email: "alex@example.test",
                  id: "adult-1",
                  name: "Alex",
                },
              }
        );
      }
      if (path.endsWith("/sign-out")) {
        signOutCalls += 1;
        signedOut = true;
        return Response.json({ success: true });
      }
      if (path.endsWith("/organization/set-active")) {
        return Response.json(family);
      }
      if (path === "/v1/families" && request.method === "GET") {
        return Response.json(family ? [family] : []);
      }
      if (path === "/v1/families/family-1") {
        return Response.json(family);
      }
      if (path === "/v1/families" && request.method === "POST") {
        expect(request.headers.get("x-meal-planner-user")).toBe("adult-1");
        const command = Schema.decodeUnknownSync(CreateFamily, {
          onExcessProperty: "error",
        })(await request.json());
        createCalls.push(command);
        if (fixture.createError) {
          return Response.json(
            {
              _tag: fixture.createError._tag,
              message: "Family request failed.",
              reason: "mutation_collision",
            },
            { status: fixture.createError.status }
          );
        }
        await fixture.createReply.promise;
        family = {
          canManage: true,
          createdAtEpochMs: 1,
          id: "family-1",
          name: command.name,
          setup: { status: "in_progress" },
          slug: "morgan-family",
          updatedAtEpochMs: 1,
          version: 1,
        };
        return Response.json(family);
      }
      throw new Error(`Unexpected fixture path: ${request.method} ${path}`);
    }) satisfies typeof fetch,
  };
  return fixture;
};

const setup = async (
  fixture = makeTransport(),
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
) => {
  // Both Better Auth clients and the generated people client use the runtime transport.
  currentTransport = fixture.transport;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    currentTransport(input, init)
  );
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/setup/family"] }),
    routeTree: root.addChildren([
      createRoute({
        component: () => (
          <SetupProvider>
            <FamilyNamePage />
          </SetupProvider>
        ),
        getParentRoute: () => root,
        path: "/setup/family",
      }),
      createRoute({
        component: () => <h1>Log in</h1>,
        getParentRoute: () => root,
        path: "/login",
      }),
      createRoute({
        component: () => <h1>Review your family</h1>,
        getParentRoute: () => root,
        path: "/setup/review",
      }),
    ]),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthClientContext value={makeAuthClient(fixture.transport)}>
        <ApiRuntimeContext value={browserApiRuntime()}>
          <RouterProvider router={router} />
        </ApiRuntimeContext>
      </AuthClientContext>
    </QueryClientProvider>
  );
  await screen.findByLabelText("Family name");
  return { fixture, user: userEvent.setup() };
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("scrollTo", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  // Better Auth's Nanostores session cleanup is deferred for one second.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 1100);
  });
});

it("creates one family through the generated client and opens review", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Family name"), "Morgan family");
  await user.click(screen.getByRole("button", { name: "Create family" }));
  await waitFor(() => expect(fixture.createCalls).toHaveLength(1));
  expect(fixture.createCalls[0]?.name).toBe("Morgan family");
  expect(
    screen.getByRole("button", { name: "Saving your family…" })
  ).toBeDisabled();
  expect(screen.getByLabelText("Family name")).toBeDisabled();
  fixture.createReply.resolve(null);
  await screen.findByRole("heading", { name: "Review your family" });
  await waitFor(() => expect(localStorage.length).toBe(0));
});

it("retries an uncertain creation on the mounted screen with the exact request", async () => {
  const fixture = makeTransport();
  fixture.createError = { _tag: "FamilyUnavailable", status: 503 };
  const { user } = await setup(fixture);
  await user.type(screen.getByLabelText("Family name"), "Morgan family");
  await user.click(screen.getByRole("button", { name: "Create family" }));
  await waitFor(() => expect(fixture.createCalls).toHaveLength(3), {
    timeout: 3000,
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Check and continue" })
    ).toBeEnabled()
  );
  const [first] = fixture.createCalls;
  expect(
    fixture.createCalls.every(
      (call) => JSON.stringify(call) === JSON.stringify(first)
    )
  ).toBe(true);
  fixture.createError = null;
  fixture.createReply.resolve(null);
  await user.click(screen.getByRole("button", { name: "Check and continue" }));
  await screen.findByRole("heading", { name: "Review your family" });
  expect(fixture.createCalls.at(-1)).toEqual(first);
});

it.each([
  ["FamilyUnauthorized", 401, "Your session ended"],
  ["FamilyForbidden", 403, "This account can’t create"],
  ["FamilyInvalidInput", 400, "Enter a valid family name"],
  ["FamilyRateLimited", 429, "Too many attempts"],
] as const)(
  "shows %s without automatically retrying a rejected request",
  async (_tag, status, message) => {
    const fixture = makeTransport();
    fixture.createError = { _tag, status };
    const { user } = await setup(fixture);
    await user.type(screen.getByLabelText("Family name"), "Morgan family");
    await user.click(screen.getByRole("button", { name: "Create family" }));
    await screen.findByText(message, { exact: false });
    expect(fixture.createCalls).toHaveLength(1);
  }
);

it("logs out without persisting an unsubmitted form", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Family name"), "Unsubmitted family");
  await user.click(screen.getByRole("button", { name: "Log out" }));
  await screen.findByRole("heading", { name: "Log in" });
  expect(fixture.createCalls).toHaveLength(0);
  expect(localStorage.length).toBe(0);
  expect(fixture.signOutCalls).toBe(1);
});

it("does not restore or replay an uncertain creation after a reload", async () => {
  const fixture = makeTransport();
  fixture.createError = { _tag: "FamilyUnavailable", status: 503 };
  const { user } = await setup(fixture);
  await user.type(screen.getByLabelText("Family name"), "Morgan family");
  await user.click(screen.getByRole("button", { name: "Create family" }));
  await waitFor(() => expect(fixture.createCalls).toHaveLength(3), {
    timeout: 3000,
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Check and continue" })
    ).toBeEnabled()
  );
  expect(localStorage.length).toBe(0);
  cleanup();
  await setup(fixture);
  expect(await screen.findByLabelText("Family name")).toHaveValue("");
  expect(
    screen.queryByRole("button", { name: "Check and continue" })
  ).not.toBeInTheDocument();
  expect(fixture.createCalls).toHaveLength(3);
});

it("continues a known saved family when cache refresh throws, without creating it again", async () => {
  class UnavailableRefreshClient extends QueryClient {
    override invalidateQueries(
      ...args: Parameters<QueryClient["invalidateQueries"]>
    ) {
      if (args[0]?.queryKey?.includes("list")) {
        return Promise.reject(new Error("Cache refresh failed"));
      }
      return super.invalidateQueries(...args);
    }
  }
  const fixture = makeTransport();
  fixture.createReply.resolve(null);
  const { user } = await setup(fixture, new UnavailableRefreshClient());
  await user.type(screen.getByLabelText("Family name"), "Saved family");
  await user.click(screen.getByRole("button", { name: "Create family" }));
  await screen.findByText(/Your family is saved, but we couldn’t refresh it/u);
  expect(fixture.createCalls).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Continue to review" }));
  await screen.findByRole("heading", { name: "Review your family" });
  expect(fixture.createCalls).toHaveLength(1);
});
