// @vitest-environment jsdom
import {
  CreateHouseholdPersonPayload,
  HouseholdPerson,
  InviteHouseholdAdultPayload,
  RenameHouseholdPersonPayload,
  SetupProgress,
  TransitionHouseholdPersonPayload,
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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { AuthClientContext, makeAuthClient } from "../auth/auth-client.js";
import { FamilyReviewPage } from "./family-review.js";
import { AddPersonPage } from "./people-pages.js";
import { SetupProvider } from "./setup-context.js";
import { SetupSavedPage } from "./setup-saved.js";

const familyId = "family-1";
let currentTransport: typeof fetch;
let mobileViewport = false;
const viewportListeners = new Set<() => void>();
const setMobileViewport = (next: boolean) => {
  mobileViewport = next;
  for (const listener of viewportListeners) {
    listener();
  }
};
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
const managedAdult = Schema.decodeUnknownSync(HouseholdPerson)({
  ...creator,
  associationState: "unlinked",
  associationVersion: null,
  displayName: "Jamie",
  id: "person_22222222-2222-4222-8222-222222222222",
  isCurrentAdult: false,
});
const joinedAdult = Schema.decodeUnknownSync(HouseholdPerson)({
  ...managedAdult,
  associationState: "linked",
  associationVersion: 1,
  displayName: "Morgan",
  id: "person_33333333-3333-4333-8333-333333333333",
});
const initial = Schema.decodeUnknownSync(SetupProgress)({
  checkpoint: {
    draft: { email: "", invite: false, name: "", participation: "" },
    organizationId: familyId,
    stage: "person-draft",
  },
  status: "active",
});

const makeTransport = (
  start: SetupProgress = initial,
  added: HouseholdPerson[] = [],
  rejectFirstRemove = false,
  role: "owner" | "member" = "owner",
  rejectInvite = false,
  failures: {
    readonly completion?: boolean;
    readonly pending?: boolean;
    readonly invitationReply?: Promise<null>;
  } = {}
) => {
  let progress = start;
  let completionRejected = false;
  let pendingRejected = false;
  const saveAttempts: SetupProgress[] = [];
  const removedPeople = new Map<string, HouseholdPerson>();
  let people = [creator, ...added];
  const saves: SetupProgress[] = [];
  const creates: unknown[] = [];
  const invitations: unknown[] = [];
  const renames: unknown[] = [];
  const removals: unknown[] = [];
  const createInvitation = async (request: Request): Promise<Response> => {
    const payload = Schema.decodeUnknownSync(InviteHouseholdAdultPayload)(
      await request.json()
    );
    invitations.push(payload);
    if (failures.invitationReply) {
      await failures.invitationReply;
    }
    if (rejectInvite) {
      return Response.json(
        {
          code: "invitation_rejected",
          message: "Already invited",
          reason: "already_invited",
          status: 409,
        },
        { headers: { "content-type": "application/problem+json" }, status: 409 }
      );
    }
    const person =
      people.find((item) => item.id === payload.personId) ?? creator;
    people = people.map((item) =>
      item.id === person.id
        ? Schema.decodeUnknownSync(HouseholdPerson)({
            ...item,
            associationState: "invitation_pending",
            associationVersion: 1,
          })
        : item
    );
    return Response.json(
      {
        association: "associated",
        invitationId: "invitation-111111",
        person: {
          ...person,
          associationState: "invitation_pending",
          associationVersion: 1,
        },
      },
      { status: 201 }
    );
  };
  const handlePeopleRequest = async (
    request: Request,
    path: string
  ): Promise<Response> => {
    if (path === "/v1/household/people" && request.method === "GET") {
      return Response.json({
        creatorSlot: "occupied",
        currentPersonId: creator.id,
        people,
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
      return createInvitation(request);
    }
    if (path.endsWith("/rename") && request.method === "POST") {
      const payload = Schema.decodeUnknownSync(RenameHouseholdPersonPayload)(
        await request.json()
      );
      renames.push(payload);
      const person = people.find((item) => path.includes(item.id));
      if (!person) {
        throw new Error("Missing rename target");
      }
      const updated = Schema.decodeUnknownSync(HouseholdPerson)({
        ...person,
        displayName: payload.displayName,
        version: person.version + 1,
      });
      people = people.map((item) => (item.id === person.id ? updated : item));
      return Response.json(updated);
    }
    if (path.endsWith("/remove") && request.method === "POST") {
      const payload = Schema.decodeUnknownSync(
        TransitionHouseholdPersonPayload
      )(await request.json());
      removals.push(payload);
      if (rejectFirstRemove && removals.length === 1) {
        return Response.json(
          {
            code: "people_unavailable",
            message: "The result is unknown.",
            status: 503,
          },
          {
            headers: { "content-type": "application/problem+json" },
            status: 503,
          }
        );
      }
      const person =
        removedPeople.get(payload.mutationId) ??
        people.find((item) => path.includes(item.id));
      if (!person) {
        throw new Error("Missing remove target");
      }
      removedPeople.set(payload.mutationId, person);
      people = people.filter((item) => item.id !== person.id);
      return Response.json({
        ...person,
        lifecycle: "archived",
        version: person.version + 1,
      });
    }
    throw new Error(
      `Unexpected people fixture path: ${request.method} ${path}`
    );
  };
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
      saveAttempts.push(body.setupProgress);
      if (
        failures.pending &&
        !pendingRejected &&
        body.setupProgress.checkpoint.stage === "person-manage"
      ) {
        pendingRejected = true;
        return Response.json(
          { message: "Could not save request." },
          { status: 500 }
        );
      }
      if (
        failures.completion &&
        !completionRejected &&
        progress.checkpoint.stage === "person-manage" &&
        (body.setupProgress.checkpoint.stage === "person-draft" ||
          body.setupProgress.checkpoint.stage === "family-review")
      ) {
        completionRejected = true;
        return Response.json(
          { message: "Could not save setup." },
          { status: 500 }
        );
      }
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
        members: [
          { id: "member-1", organizationId: familyId, role, userId: "adult-1" },
        ],
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
    if (path.startsWith("/v1/household/people")) {
      return handlePeopleRequest(request, path);
    }
    throw new Error(`Unexpected setup fixture path: ${request.method} ${path}`);
  };
  return {
    creates,
    invitations,
    removals,
    renames,
    saveAttempts,
    saves,
    transport,
  };
};

const setup = async (
  fixture = makeTransport(),
  initialEntry = "/setup/people"
) => {
  currentTransport = fixture.transport;
  vi.stubGlobal("fetch", sharedTransport);
  const auth = makeAuthClient(sharedTransport);
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
        component: () => (
          <SetupProvider>
            <FamilyReviewPage />
          </SetupProvider>
        ),
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
      <AuthClientContext value={auth}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthClientContext>
    </QueryClientProvider>
  );
  await (initialEntry === "/setup/people"
    ? screen.findByLabelText("Name")
    : screen.findByRole("heading", {
        hidden: true,
        name: initialEntry === "/setup/review" ? "Your family" : "Setup saved",
      }));
  return { auth, fixture, user: userEvent.setup() };
};

beforeEach(() => {
  mobileViewport = false;
  viewportListeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    addEventListener: (_event: string, listener: () => void) =>
      viewportListeners.add(listener),
    matches: query === "(max-width: 767px)" && mobileViewport,
    media: query,
    removeEventListener: (_event: string, listener: () => void) =>
      viewportListeners.delete(listener),
  }));
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
  expect(screen.getByLabelText("Email")).toBeDisabled();
  await waitFor(() => expect(screen.getByLabelText("Email")).not.toBeVisible());
  await user.click(screen.getByRole("button", { name: "Add person" }));
  await waitFor(() => expect(fixture.creates).toHaveLength(1));
  await screen.findByRole("heading", { name: "Setup home" });
  expect(fixture.creates[0]).toMatchObject({
    displayName: "Jamie",
    kind: "adult",
  });
  expect(fixture.invitations).toHaveLength(0);
});

it("invites an existing adult without creating a second person and restores the Add draft", async () => {
  const fixture = makeTransport(initial, [managedAdult]);
  const { user } = await setup(fixture);
  await user.type(screen.getByLabelText("Name"), "Taylor");
  await user.click(screen.getByRole("button", { name: "Adult" }));
  await user.click(screen.getByRole("button", { name: "Invite" }));
  expect(
    await screen.findByRole("heading", { name: "Invite Jamie" })
  ).toBeInTheDocument();
  expect(screen.getByText("Add person", { selector: "button" })).toBeDisabled();
  expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
  expect(fixture.saveAttempts).toHaveLength(0);
  await user.type(
    screen.getByRole("textbox", { name: "Email" }),
    "jamie@example.test"
  );
  await user.click(screen.getByRole("button", { name: "Invite Jamie" }));
  await waitFor(() => expect(fixture.invitations).toHaveLength(1));
  expect(fixture.saves[0]).toMatchObject({
    checkpoint: {
      returnTo: {
        draft: { name: "Taylor", participation: "adult" },
        stage: "person-draft",
      },
      stage: "person-manage",
      state: { phase: "pending" },
    },
  });
  expect(fixture.invitations[0]).toMatchObject({
    email: "jamie@example.test",
    personId: managedAdult.id,
  });
  expect(fixture.creates).toHaveLength(0);
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Invite Jamie" })
    ).not.toBeInTheDocument()
  );
  expect(screen.getByLabelText("Name")).toHaveValue("Taylor");
  expect(fixture.saves.at(-1)).toMatchObject({
    checkpoint: { draft: { participation: "adult" }, stage: "person-draft" },
  });
});

it("explains a rejected invitation without claiming success or creating another person", async () => {
  const fixture = makeTransport(initial, [managedAdult], false, "owner", true);
  const { user } = await setup(fixture);
  await user.click(screen.getByRole("button", { name: "Invite" }));
  await user.type(
    await screen.findByRole("textbox", { name: "Email" }),
    "jamie@example.test"
  );
  await user.click(screen.getByRole("button", { name: "Invite Jamie" }));
  expect(
    await screen.findByText(/invitation is already waiting/u)
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Invite Jamie" })
  ).toBeInTheDocument();
  expect(fixture.creates).toHaveLength(0);
  expect(fixture.invitations).toHaveLength(1);
  expect(fixture.saves.at(-1)).toMatchObject({
    checkpoint: { stage: "person-draft" },
  });
});

it("edits a person and returns to the same Add draft after closing", async () => {
  const fixture = makeTransport(initial, [managedAdult]);
  const { user } = await setup(fixture);
  await user.type(screen.getByLabelText("Name"), "Taylor");
  await user.click(screen.getByRole("button", { name: "Manage Jamie" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit name" }));
  expect(
    await screen.findByRole("heading", { name: "Edit Jamie’s name" })
  ).toBeInTheDocument();
  await user.clear(
    screen.getByLabelText("Name", { selector: "#roster-edit-name" })
  );
  await user.type(
    screen.getByLabelText("Name", { selector: "#roster-edit-name" }),
    "Jordan"
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(fixture.renames).toHaveLength(1));
  expect(fixture.renames[0]).toMatchObject({
    displayName: "Jordan",
    expectedVersion: managedAdult.version,
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Edit Jamie’s name" })
    ).not.toBeInTheDocument()
  );
  expect(screen.getByLabelText("Name")).toHaveValue("Taylor");
});

it("closes an unsubmitted edit without changing the person or losing the Add draft", async () => {
  const fixture = makeTransport(initial, [managedAdult]);
  const { user } = await setup(fixture);
  await user.type(screen.getByLabelText("Name"), "Taylor");
  await user.click(screen.getByRole("button", { name: "Adult" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Invite them to join" })
  );
  await user.type(screen.getByRole("textbox", { name: "Email" }), "taylor@");
  await user.click(screen.getByRole("button", { name: "Manage Jamie" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit name" }));
  await user.clear(
    screen.getByLabelText("Name", { selector: "#roster-edit-name" })
  );
  await user.type(
    screen.getByLabelText("Name", { selector: "#roster-edit-name" }),
    "Jordan"
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Edit Jamie’s name" })
    ).not.toBeInTheDocument()
  );
  expect(screen.getByLabelText("Name")).toHaveValue("Taylor");
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("taylor@");
  expect(
    screen.getByRole("checkbox", { name: "Invite them to join" })
  ).toBeChecked();
  expect(fixture.renames).toHaveLength(0);
  expect(fixture.saveAttempts).toHaveLength(0);
});

it("opens and closes locally with Escape even when checkpoint writes would fail", async () => {
  const fixture = makeTransport(
    initial,
    [managedAdult],
    false,
    "owner",
    false,
    { pending: true }
  );
  const { user } = await setup(fixture);
  await user.type(screen.getByLabelText("Name"), "Taylor");
  await user.click(screen.getByRole("button", { name: "Manage Jamie" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit name" }));
  expect(
    await screen.findByRole("heading", { name: "Edit Jamie’s name" })
  ).toBeInTheDocument();
  expect(fixture.saveAttempts).toHaveLength(0);
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Edit Jamie’s name" })
    ).not.toBeInTheDocument()
  );
  expect(screen.getByLabelText("Name")).toHaveValue("Taylor");
  expect(fixture.saveAttempts).toHaveLength(0);
  expect(fixture.renames).toHaveLength(0);
});

it("retains the submitted command when its checkpoint write fails and dispatches only after retry saves it", async () => {
  const fixture = makeTransport(
    initial,
    [managedAdult],
    false,
    "owner",
    false,
    { pending: true }
  );
  const { user } = await setup(fixture);
  await user.click(screen.getByRole("button", { name: "Invite" }));
  await user.type(
    screen.getByRole("textbox", { name: "Email" }),
    "jamie@example.test"
  );
  await user.click(screen.getByRole("button", { name: "Invite Jamie" }));
  expect(
    await screen.findByText(/kept this exact request/u)
  ).toBeInTheDocument();
  expect(fixture.invitations).toHaveLength(0);
  expect(fixture.saveAttempts).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("heading", { name: "Invite Jamie" })
  ).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Email" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Check and continue" }));
  await waitFor(() => expect(fixture.invitations).toHaveLength(1));
  expect(fixture.saveAttempts[1]).toEqual(fixture.saveAttempts[0]);
});

it("retries the original successful removal if saving its completion fails", async () => {
  const fixture = makeTransport(
    initial,
    [managedAdult],
    false,
    "owner",
    false,
    { completion: true }
  );
  const { user } = await setup(fixture);
  await user.click(screen.getByRole("button", { name: "Manage Jamie" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Remove from family" })
  );
  await user.click(screen.getByRole("button", { name: "Remove Jamie" }));
  expect(
    await screen.findByText(/kept this exact request/u)
  ).toBeInTheDocument();
  expect(fixture.removals).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Check and continue" }));
  await waitFor(() => expect(fixture.removals).toHaveLength(2));
  expect(fixture.removals[1]).toEqual(fixture.removals[0]);
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Remove Jamie from family?" })
    ).not.toBeInTheDocument()
  );
});

it("removes a joined adult after explicit confirmation, keeping the exact version and mutation ID", async () => {
  const review = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint: { organizationId: familyId, stage: "family-review" },
    status: "active",
  });
  const fixture = makeTransport(review, [joinedAdult]);
  const { user } = await setup(fixture, "/setup/review");
  await user.click(screen.getByRole("button", { name: "Manage Morgan" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Remove from family" })
  );
  expect(
    await screen.findByText(
      "Their account will stay active, but they’ll lose access to this family. Their profile will be archived."
    )
  ).toBeInTheDocument();
  expect(fixture.removals).toHaveLength(0);
  expect(fixture.saveAttempts).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Remove Morgan" }));
  await waitFor(() => expect(fixture.removals).toHaveLength(1));
  expect(fixture.removals[0]).toMatchObject({
    expectedVersion: joinedAdult.version,
    mutationId: expect.any(String),
  });
  await waitFor(() =>
    expect(screen.queryByText("Morgan")).not.toBeInTheDocument()
  );
});

it("shows members only their own edit action", async () => {
  const review = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint: { organizationId: familyId, stage: "family-review" },
    status: "active",
  });
  const { user } = await setup(
    makeTransport(review, [managedAdult, joinedAdult], false, "member"),
    "/setup/review"
  );
  expect(
    screen.queryByRole("button", { name: "Invite" })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Manage Jamie" })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Manage Morgan" })
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Manage Alex" }));
  expect(
    await screen.findByRole("menuitem", { name: "Edit name" })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "Remove from family" })
  ).not.toBeInTheDocument();
});

it("retains an uncertain removal across reload and retries the exact request", async () => {
  const review = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint: { organizationId: familyId, stage: "family-review" },
    status: "active",
  });
  const fixture = makeTransport(review, [managedAdult], true);
  const { user } = await setup(fixture, "/setup/review");
  await user.click(screen.getByRole("button", { name: "Manage Jamie" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Remove from family" })
  );
  await user.click(screen.getByRole("button", { name: "Remove Jamie" }));
  await waitFor(() => expect(fixture.removals).toHaveLength(1));
  expect(
    await screen.findByText(/kept this exact request/u)
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Close" })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save & exit" })
  ).not.toBeInTheDocument();
  expect(fixture.saves.at(-1)).toMatchObject({
    checkpoint: {
      stage: "person-manage",
      state: { command: { mutationId: expect.any(String) }, phase: "pending" },
    },
    status: "active",
  });
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("heading", { name: "Remove Jamie from family?" })
  ).toBeInTheDocument();
  cleanup();
  const resumed = await setup(fixture, "/setup/review");
  expect(
    await screen.findByRole("heading", { name: "Remove Jamie from family?" })
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await resumed.user.click(
    await screen.findByRole("button", { name: "Check and continue" })
  );
  await waitFor(() => expect(fixture.removals).toHaveLength(2));
  expect(fixture.removals[1]).toEqual(fixture.removals[0]);
});

it("replaces an unsubmitted local draft with a pending request received on session refresh", async () => {
  const review = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint: { organizationId: familyId, stage: "family-review" },
    status: "active",
  });
  const fixture = makeTransport(review, [managedAdult]);
  const { auth, user } = await setup(fixture, "/setup/review");
  await user.click(screen.getByRole("button", { name: "Invite" }));
  await user.type(
    screen.getByRole("textbox", { name: "Email" }),
    "local-draft@example.test"
  );
  const pending = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint: {
      organizationId: familyId,
      returnTo: { stage: "family-review" },
      stage: "person-manage",
      state: {
        command: {
          email: "saved-request@example.test",
          kind: "invite",
          mutationId: "other-tab-invitation",
          person: managedAdult,
        },
        phase: "pending",
      },
    },
    status: "active",
  });
  await act(async () => {
    await auth.updateUser({ setupProgress: pending });
  });
  expect(
    await screen.findByRole("heading", { name: "Invite Jamie" })
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue(
      "saved-request@example.test"
    )
  );
  expect(screen.getByRole("textbox", { name: "Email" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Check and continue" }));
  await waitFor(() => expect(fixture.invitations).toHaveLength(1));
  expect(fixture.invitations[0]).toMatchObject({
    email: "saved-request@example.test",
    mutationId: "other-tab-invitation",
  });
  expect(fixture.removals).toHaveLength(0);
});

it("preserves the editable roster form while switching between desktop dialog and mobile drawer", async () => {
  const fixture = makeTransport(initial, [managedAdult]);
  const { user } = await setup(fixture);
  await user.click(screen.getByRole("button", { name: "Invite" }));
  await user.type(screen.getByRole("textbox", { name: "Email" }), "jamie@");
  await act(async () => {
    setMobileViewport(true);
  });
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("jamie@");
  await user.type(
    screen.getByRole("textbox", { name: "Email" }),
    "example.test"
  );
  await act(async () => {
    setMobileViewport(false);
  });
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue(
    "jamie@example.test"
  );
  expect(fixture.saveAttempts).toHaveLength(0);
});

it("keeps a locally retained request when another tab saves a different pending command", async () => {
  const review = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint: { organizationId: familyId, stage: "family-review" },
    status: "active",
  });
  const fixture = makeTransport(review, [managedAdult], false, "owner", false, {
    pending: true,
  });
  const { auth, user } = await setup(fixture, "/setup/review");
  await user.click(screen.getByRole("button", { name: "Invite" }));
  await user.type(
    screen.getByRole("textbox", { name: "Email" }),
    "jamie@example.test"
  );
  await user.click(screen.getByRole("button", { name: "Invite Jamie" }));
  expect(
    await screen.findByText(/kept this exact request/u)
  ).toBeInTheDocument();
  const [original] = fixture.saveAttempts;
  const otherPending = Schema.decodeUnknownSync(SetupProgress)({
    checkpoint: {
      organizationId: familyId,
      returnTo: { stage: "family-review" },
      stage: "person-manage",
      state: {
        command: {
          kind: "remove",
          mutationId: "other-tab-removal",
          person: managedAdult,
        },
        phase: "pending",
      },
    },
    status: "active",
  });
  await act(async () => {
    await auth.updateUser({ setupProgress: otherPending });
  });
  expect(
    await screen.findByText(/Another setup request is pending/u)
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Invite Jamie" })
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Check and continue" })
  ).toBeDisabled();
  await act(async () => {
    await auth.updateUser({ setupProgress: review });
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Check and continue" })
    ).toBeEnabled()
  );
  await user.click(screen.getByRole("button", { name: "Check and continue" }));
  await waitFor(() => expect(fixture.invitations).toHaveLength(1));
  expect(fixture.saveAttempts[3]).toEqual(original);
  expect(fixture.removals).toHaveLength(0);
});

it.each(["success", "rejected"] as const)(
  "keeps a newer saved request when an earlier invitation returns %s",
  async (outcome) => {
    const review = Schema.decodeUnknownSync(SetupProgress)({
      checkpoint: { organizationId: familyId, stage: "family-review" },
      status: "active",
    });
    const invitationReply = Promise.withResolvers<null>();
    const fixture = makeTransport(
      review,
      [managedAdult],
      false,
      "owner",
      outcome === "rejected",
      { invitationReply: invitationReply.promise }
    );
    const { auth, user } = await setup(fixture, "/setup/review");
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "jamie@example.test"
    );
    await user.click(screen.getByRole("button", { name: "Invite Jamie" }));
    await waitFor(() => expect(fixture.invitations).toHaveLength(1));
    const [original] = fixture.saveAttempts;
    const otherPending = Schema.decodeUnknownSync(SetupProgress)({
      checkpoint: {
        organizationId: familyId,
        returnTo: { stage: "family-review" },
        stage: "person-manage",
        state: {
          command: {
            kind: "remove",
            mutationId: "newer-saved-request",
            person: managedAdult,
          },
          phase: "pending",
        },
      },
      status: "active",
    });
    await act(async () => {
      await auth.updateUser({ setupProgress: otherPending });
    });
    expect(
      await screen.findByText(/Another setup request is pending/u)
    ).toBeInTheDocument();
    await act(async () => {
      invitationReply.resolve(null);
    });
    expect(
      await screen.findByText(/kept this exact request/u)
    ).toBeInTheDocument();
    expect(fixture.saveAttempts).toHaveLength(2);
    expect(fixture.saves.at(-1)).toEqual(otherPending);
    expect(
      screen.getByRole("heading", { name: "Invite Jamie" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => {
      await auth.updateUser({ setupProgress: review });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Check and continue" })
      ).toBeEnabled()
    );
    await user.click(
      screen.getByRole("button", { name: "Check and continue" })
    );
    await waitFor(() => expect(fixture.invitations).toHaveLength(2));
    expect(fixture.invitations[1]).toEqual(fixture.invitations[0]);
    expect(fixture.saveAttempts[3]).toEqual(original);
  }
);

it("adds a child as a managed profile without an invitation choice", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Name"), "Sam");
  await user.click(screen.getByRole("button", { name: "Child" }));
  expect(
    screen.queryByRole("checkbox", { name: "Invite them to join" })
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toBeDisabled();
  await waitFor(() => expect(screen.getByLabelText("Email")).not.toBeVisible());
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
  await user.type(
    screen.getByRole("textbox", { name: "Email" }),
    "not-an-email"
  );
  await user.click(screen.getByRole("button", { name: "Add and invite" }));
  expect(
    await screen.findByText("Enter a valid email address.")
  ).toBeInTheDocument();
  expect(fixture.creates).toHaveLength(0);
  await user.clear(screen.getByRole("textbox", { name: "Email" }));
  await user.type(
    screen.getByRole("textbox", { name: "Email" }),
    "jamie@example.test"
  );
  await user.click(screen.getByRole("button", { name: "Add and invite" }));
  await waitFor(() => expect(fixture.invitations).toHaveLength(1));
  await screen.findByRole("heading", { name: "Setup home" });
  expect(fixture.invitations[0]).toMatchObject({ email: "jamie@example.test" });
});

it("preserves an invitation email across checkbox changes and validates it when invited again", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Name"), "Jamie");
  await user.click(screen.getByRole("button", { name: "Adult" }));
  const invite = screen.getByRole("checkbox", { name: "Invite them to join" });
  await user.click(
    screen.getByText("Let them sign in and manage their preferences.")
  );
  expect(invite).toBeChecked();
  await user.type(screen.getByRole("textbox", { name: "Email" }), "invalid");
  await user.click(invite);
  expect(screen.getByLabelText("Email")).toBeDisabled();
  await waitFor(() => expect(screen.getByLabelText("Email")).not.toBeVisible());
  expect(invite).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Add person" })).toHaveFocus();
  expect(
    screen.getByRole("heading", { name: "Add someone" })
  ).toBeInTheDocument();
  await user.click(invite);
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("invalid");
  await user.click(screen.getByRole("button", { name: "Add and invite" }));
  expect(
    await screen.findByText("Enter a valid email address.")
  ).toBeInTheDocument();
  expect(fixture.creates).toHaveLength(0);
});

it("clears invite consent and invalid email across Adult, Child, Adult changes", async () => {
  const { fixture, user } = await setup();
  await user.type(screen.getByLabelText("Name"), "Riley");
  await user.click(screen.getByRole("button", { name: "Adult" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Invite them to join" })
  );
  await user.type(screen.getByRole("textbox", { name: "Email" }), "invalid");
  await user.click(screen.getByRole("button", { name: "Child" }));
  expect(
    screen.queryByRole("checkbox", { name: "Invite them to join" })
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toBeDisabled();
  await waitFor(() => expect(screen.getByLabelText("Email")).not.toBeVisible());
  expect(screen.queryByText("Enter their email.")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Enter a valid email address.")
  ).not.toBeInTheDocument();
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
  fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
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
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue(
    "jamie@example.test"
  );
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
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue(
    "taylor-review@example.test"
  );
});
