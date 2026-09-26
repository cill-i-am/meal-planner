// @vitest-environment jsdom
import {
  CreateHouseholdPersonPayload,
  HouseholdPerson,
  SetupProgress,
} from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AuthClientContext, makeAuthClient } from "../auth/auth-client.js";
import { AddPersonPage } from "./people-pages.js";
import { SetupProvider } from "./setup-context.js";
import { SetupSavedPage } from "./setup-saved.js";

const familyId = "family-1";
let currentTransport: typeof fetch;
const sharedTransport: typeof fetch = (input, init) =>
  currentTransport(input, init);
const creator = Schema.decodeUnknownSync(HouseholdPerson)({
  associationState: "linked",
  associationVersion: 1,
  createdAtEpochMs: 1,
  displayName: "Alex",
  id: "person_11111111-1111-4111-8111-111111111111",
  isCurrentAdult: true,
  kind: "adult",
  lifecycle: "active",
  updatedAtEpochMs: 1,
  version: 1,
});
const initial = Schema.decodeUnknownSync(SetupProgress)({
  checkpoint: {
    draft: { email: "", invite: false, name: "", participation: "" },
    organizationId: familyId,
    stage: "person-draft",
  },
  status: "active",
});

const makeTransport = (start: SetupProgress = initial) => {
  let progress = start;
  const saves: SetupProgress[] = [];
  const creates: unknown[] = [];
  const invitations: unknown[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/get-session")) {
      return Response.json({
        session: {
          activeOrganizationId: familyId,
          expiresAt: "2099-01-01T00:00:00Z",
          id: "session-1",
          userId: "adult-1",
        },
        user: {
          email: "alex@example.test",
          id: "adult-1",
          name: "Alex",
          setupProgress: progress,
        },
      });
    }
    if (path.endsWith("/update-user")) {
      const body = Schema.decodeUnknownSync(
        Schema.Struct({ setupProgress: SetupProgress })
      )(await request.json());
      progress = body.setupProgress;
      saves.push(progress);
      return Response.json({ status: true });
    }
    if (path.endsWith("/organization/list")) {
      return Response.json([
        { id: familyId, name: "Morgan family", slug: "morgan" },
      ]);
    }
    if (path.endsWith("/organization/get-full-organization")) {
      return Response.json({
        id: familyId,
        name: "Morgan family",
        slug: "morgan",
      });
    }
    if (path.endsWith("/organization/set-active")) {
      return Response.json({
        id: familyId,
        name: "Morgan family",
        slug: "morgan",
      });
    }
    if (path === "/v1/household/people" && request.method === "GET") {
      return Response.json({
        creatorSlot: "occupied",
        currentPersonId: creator.id,
        people: [creator],
      });
    }
    if (path === "/v1/household/people" && request.method === "POST") {
      const payload = Schema.decodeUnknownSync(CreateHouseholdPersonPayload)(
        await request.json()
      );
      creates.push(payload);
      return Response.json(
        {
          ...creator,
          associationState: "unlinked",
          associationVersion: null,
          displayName: payload.displayName,
          id: "person_22222222-2222-4222-8222-222222222222",
          isCurrentAdult: false,
          kind: payload.kind,
        },
        { status: 201 }
      );
    }
    if (path === "/v1/household/people/invitations") {
      invitations.push(await request.json());
      return Response.json(
        {
          association: "associated",
          invitationId: "invitation-111111",
          person: { ...creator, associationState: "invitation_pending" },
        },
        { status: 201 }
      );
    }
    throw new Error(`Unexpected setup fixture path: ${request.method} ${path}`);
  };
  return { creates, invitations, saves, transport };
};

const setup = async (
  fixture = makeTransport(),
  initialEntry = "/setup/people"
) => {
  currentTransport = fixture.transport;
  vi.stubGlobal("fetch", sharedTransport);
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    routeTree: root.addChildren([
      createRoute({
        component: () => (
          <SetupProvider>
            <AddPersonPage />
          </SetupProvider>
        ),
        getParentRoute: () => root,
        path: "/setup/people",
      }),
      createRoute({
        component: () => (
          <SetupProvider>
            <SetupSavedPage />
          </SetupProvider>
        ),
        getParentRoute: () => root,
        path: "/setup/saved",
      }),
      createRoute({
        component: () => <h1>Review your family</h1>,
        getParentRoute: () => root,
        path: "/setup/review",
      }),
      createRoute({
        component: () => <h1>Setup home</h1>,
        getParentRoute: () => root,
        path: "/setup",
      }),
    ]),
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <AuthClientContext value={makeAuthClient(sharedTransport)}>
        <RouterProvider router={router} />
      </AuthClientContext>
    </QueryClientProvider>
  );
  await (initialEntry === "/setup/people"
    ? screen.findByLabelText("Name")
    : screen.findByRole("heading", { name: "Setup saved" }));
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

it("adds an adult without an account unless invitation is chosen", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Name"), "Jamie");
  await user.click(screen.getByRole("button", { name: "Adult" }));
  expect(
    screen.getByRole("checkbox", { name: "Invite them to join" })
  ).not.toBeChecked();
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add person" }));
  await waitFor(() => expect(fixture.creates).toHaveLength(1));
  await screen.findByRole("heading", { name: "Setup home" });
  expect(fixture.creates[0]).toMatchObject({
    displayName: "Jamie",
    kind: "adult",
  });
  expect(fixture.invitations).toHaveLength(0);
});

it("adds a child as a managed profile without an invitation choice", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Name"), "Sam");
  await user.click(screen.getByRole("button", { name: "Child" }));
  expect(
    screen.queryByRole("checkbox", { name: "Invite them to join" })
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add person" }));
  await waitFor(() => expect(fixture.creates).toHaveLength(1));
  await screen.findByRole("heading", { name: "Setup home" });
  expect(fixture.creates[0]).toMatchObject({
    displayName: "Sam",
    kind: "dependant",
  });
  expect(fixture.invitations).toHaveLength(0);
});

it("requires a valid email when inviting and sends the invitation for an adult", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Name"), "Jamie");
  await user.click(screen.getByRole("button", { name: "Adult" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Invite them to join" })
  );
  expect(
    screen.getByRole("button", { name: "Add and invite" })
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add and invite" }));
  expect(await screen.findByText("Enter their email.")).toBeInTheDocument();
  expect(fixture.creates).toHaveLength(0);
  await user.type(screen.getByLabelText("Email"), "not-an-email");
  await user.click(screen.getByRole("button", { name: "Add and invite" }));
  expect(
    await screen.findByText("Enter a valid email address.")
  ).toBeInTheDocument();
  expect(fixture.creates).toHaveLength(0);
  await user.clear(screen.getByLabelText("Email"));
  await user.type(screen.getByLabelText("Email"), "jamie@example.test");
  await user.click(screen.getByRole("button", { name: "Add and invite" }));
  await waitFor(() => expect(fixture.invitations).toHaveLength(1));
  await screen.findByRole("heading", { name: "Setup home" });
  expect(fixture.invitations[0]).toMatchObject({ email: "jamie@example.test" });
});

it("clears invite consent and invalid email across Adult, Child, Adult changes", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Name"), "Riley");
  await user.click(screen.getByRole("button", { name: "Adult" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Invite them to join" })
  );
  await user.type(screen.getByLabelText("Email"), "invalid");
  await user.click(screen.getByRole("button", { name: "Child" }));
  expect(
    screen.queryByRole("checkbox", { name: "Invite them to join" })
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Adult" }));
  expect(
    screen.getByRole("checkbox", { name: "Invite them to join" })
  ).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Add person" }));
  await waitFor(() => expect(fixture.creates).toHaveLength(1));
  await screen.findByRole("heading", { name: "Setup home" });
  expect(fixture.creates[0]).toMatchObject({
    displayName: "Riley",
    kind: "adult",
  });
  expect(fixture.invitations).toHaveLength(0);
});

it("preserves an opted-in invitation email through Save & exit and resume", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Name"), "Jamie");
  await user.click(screen.getByRole("button", { name: "Adult" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Invite them to join" })
  );
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "jamie@example.test" },
  });
  await user.click(screen.getByRole("button", { name: "Save & exit" }));
  await screen.findByRole("heading", { name: "Setup saved" });
  expect(fixture.saves.at(-1)).toMatchObject({
    checkpoint: {
      draft: {
        email: "jamie@example.test",
        invite: true,
        name: "Jamie",
        participation: "adult",
      },
    },
    status: "paused",
  });
  await user.click(screen.getByRole("button", { name: "Resume setup" }));
  expect(
    await screen.findByRole("checkbox", { name: "Invite them to join" })
  ).toBeChecked();
  expect(screen.getByLabelText("Email")).toHaveValue("jamie@example.test");
});

it("restores an opted-in invitation email after loading a saved setup afresh", async () => {
  const paused = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint: {
      draft: {
        email: "taylor-review@example.test",
        invite: true,
        name: "Taylor",
        participation: "adult",
      },
      organizationId: familyId,
      stage: "person-draft",
    },
    status: "paused",
  });
  const { user } = await setup(makeTransport(paused), "/setup/saved");
  await user.click(screen.getByRole("button", { name: "Resume setup" }));
  expect(
    await screen.findByRole("checkbox", { name: "Invite them to join" })
  ).toBeChecked();
  expect(screen.getByLabelText("Name")).toHaveValue("Taylor");
  expect(screen.getByLabelText("Email")).toHaveValue(
    "taylor-review@example.test"
  );
});
