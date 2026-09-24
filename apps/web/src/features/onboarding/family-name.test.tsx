// @vitest-environment jsdom
import { SetupProgress } from "@meal-planner/household-api";
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

import { AuthClientContext, makeAuthClient } from "../auth/auth-client.js";
import { FamilyNamePage } from "./family-name.js";
import { SetupProvider } from "./setup-context.js";
import { initialSetup } from "./setup-state.js";

const restored = Schema.decodeUnknownSync(SetupProgress)({
  checkpoint: {
    creator: { displayName: "Alex", mutationId: "bootstrap-11111111" },
    name: "Morgan family",
    slug: "family-11111111-1111-4111-8111-111111111111",
    stage: "family-create",
  },
  status: "active",
});
let currentTransport: typeof fetch;
const makeTransport = (initial: SetupProgress = initialSetup) => {
  let progress = initial;
  let version = 0;
  let family: { id: string; name: string; slug: string } | null = null;
  let signedOut = false;
  let signOutCalls = 0;
  const saves: SetupProgress[] = [];
  const createCalls: string[] = [];
  const fixture = {
    createCalls,
    createReply: Promise.withResolvers<null>(),
    failConflict: false,
    failCreate: false,
    failSave: false,
    saves,
    get signOutCalls() {
      return signOutCalls;
    },
    transport: (async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/get-session")) {
        if (signedOut) {
          return Response.json(null);
        }
        return Response.json({
          session: {
            activeOrganizationId: family?.id,
            expiresAt: "2099-01-01T00:00:00Z",
            id: "session-1",
            userId: "adult-1",
          },
          user: {
            email: "alex@example.test",
            id: "adult-1",
            name: "Alex",
            setupProgress: progress,
            setupProgressVersion: version,
          },
        });
      }
      if (path.endsWith("/setup/progress")) {
        const body = Schema.decodeUnknownSync(
          Schema.Struct({
            expectedVersion: Schema.Number,
            progress: SetupProgress,
          })
        )(await request.json());
        saves.push(body.progress);
        if (fixture.failSave) {
          return Response.json(
            { code: "SERVICE_UNAVAILABLE" },
            { status: 503 }
          );
        }
        if (body.expectedVersion !== version) {
          return Response.json(
            { code: "SETUP_PROGRESS_CONFLICT" },
            { status: 409 }
          );
        }
        ({ progress } = body);
        version += 1;
        return Response.json({ progress, version });
      }
      if (path.endsWith("/organization/list")) {
        return Response.json(family ? [family] : []);
      }
      if (path.endsWith("/sign-out")) {
        signOutCalls += 1;
        signedOut = true;
        return Response.json({ success: true });
      }
      if (path.endsWith("/organization/get-full-organization")) {
        return Response.json(family);
      }
      if (path === "/v1/setup/family") {
        const { name } = Schema.decodeUnknownSync(
          Schema.Struct({ name: Schema.String })
        )(await request.json());
        createCalls.push(name);
        if (fixture.failConflict) {
          return Response.json(
            {
              _tag: "SetupFamilyConflict",
              message: "Another family request is saved.",
            },
            { status: 409 }
          );
        }
        if (fixture.failCreate) {
          return Response.json({ code: "UNAVAILABLE" }, { status: 503 });
        }
        await fixture.createReply.promise;
        family = { id: "family-1", name, slug: "family-1" };
        progress = {
          checkpoint: { organizationId: family.id, stage: "family-review" },
          status: "active",
        } as SetupProgress;
        version += 2;
        return Response.json(
          { name, organizationId: family.id },
          { status: 201 }
        );
      }
      throw new Error(`Unexpected setup fixture path: ${path}`);
    }) satisfies typeof fetch,
  };
  return fixture;
};

const setup = async (fixture = makeTransport()) => {
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
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <AuthClientContext value={makeAuthClient(fixture.transport)}>
        <RouterProvider router={router} />
      </AuthClientContext>
    </QueryClientProvider>
  );
  await screen.findByLabelText("Family name");
  return { fixture, user: userEvent.setup() };
};

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observed = new Set<Element>();
      observe(element: Element) {
        this.observed.add(element);
      }
      disconnect() {
        this.observed.clear();
      }
    }
  );
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

it("submits family creation once and shows a pending button without a recovery alert", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Family name"), "Morgan family");
  await user.click(screen.getByRole("button", { name: "Create family" }));
  await waitFor(() => expect(fixture.createCalls).toEqual(["Morgan family"]));
  expect(fixture.saves).toEqual([]);
  expect(
    screen.getByRole("button", { name: "Saving your family…" })
  ).toBeDisabled();
  expect(
    screen.getByRole("heading", { name: "Name your family" })
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Family name")).toBeDisabled();
  fixture.createReply.resolve(null);
  expect(
    await screen.findByRole("heading", { name: "Review your family" })
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("retries a failed submit without creating a browser-side checkpoint", async () => {
  const fixture = makeTransport();
  fixture.failCreate = true;
  const { user } = await setup(fixture);
  await user.type(screen.getByLabelText("Family name"), "Morgan family");
  await user.click(screen.getByRole("button", { name: "Create family" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t finish creating your family"
  );
  expect(screen.getByLabelText("Family name")).toBeEnabled();
  fixture.failCreate = false;
  await user.click(screen.getByRole("button", { name: "Create family" }));
  await waitFor(() => expect(fixture.createCalls).toHaveLength(2));
  expect(fixture.createCalls).toEqual(["Morgan family", "Morgan family"]);
  expect(fixture.saves).toEqual([]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fixture.createReply.resolve(null);
  expect(
    await screen.findByRole("heading", { name: "Review your family" })
  ).toBeInTheDocument();
});

it("shows the typed conflict from the family command", async () => {
  const fixture = makeTransport();
  fixture.failConflict = true;
  const { user } = await setup(fixture);
  await user.type(screen.getByLabelText("Family name"), "Morgan family");
  await user.click(screen.getByRole("button", { name: "Create family" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Another family request is saved"
  );
  expect(fixture.saves).toEqual([]);
});

it("offers recovery for a restored unfinished creation and reuses its command", async () => {
  const fixture = makeTransport(restored);
  const { user } = await setup(fixture);
  expect(
    screen.getByRole("heading", { name: "Let’s check your family" })
  ).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "still need to confirm the result"
  );
  expect(screen.getByLabelText("Family name")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Check and continue" }));
  await waitFor(() => expect(fixture.createCalls).toEqual(["Morgan family"]));
  expect(fixture.saves).toEqual([]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fixture.createReply.resolve(null);
  expect(
    await screen.findByRole("heading", { name: "Review your family" })
  ).toBeInTheDocument();
});

it("saves a family-name draft before logging out", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Family name"), "Morgan family");
  await user.click(screen.getByRole("button", { name: "Log out" }));
  await screen.findByRole("heading", { name: "Log in" });
  expect(fixture.saves.at(-1)).toMatchObject({
    checkpoint: { name: "Morgan family", stage: "family-name" },
    status: "paused",
  });
  expect(fixture.signOutCalls).toBe(1);
});

it("retains the exact unfinished creation when logging out", async () => {
  const { fixture, user } = await setup(makeTransport(restored));
  await user.click(screen.getByRole("button", { name: "Log out" }));
  await screen.findByRole("heading", { name: "Log in" });
  expect(fixture.saves.at(-1)).toEqual({
    checkpoint: restored.checkpoint,
    status: "paused",
  });
  expect(fixture.signOutCalls).toBe(1);
});
