import {
  ConversationAction,
  ConversationView,
} from "@meal-planner/agent-conversations-api";
import { CreateFamily } from "@meal-planner/families";
import {
  CreateHouseholdPersonPayload,
  HouseholdPerson,
  RenameHouseholdPersonPayload,
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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MotionProvider } from "../../components/ui/motion-provider.js";
import { ApiRuntimeContext, browserApiRuntime } from "../api-client/index.js";
import { AuthClientContext, makeAuthClient } from "../auth/auth-client.js";
import { FamilySetupPage } from "./family-setup.js";
import { SetupProvider } from "./setup-provider.js";

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

const conversationView = Schema.decodeUnknownSync(ConversationView)({
  actions: [],
  blocks: [
    {
      _tag: "RosterProposal",
      creatorName: "Alex",
      familyName: "Murphy family",
      id: "f1bc16e9-1370-4606-862f-245eac4fd4f0",
      people: [
        {
          displayName: "Sam",
          draftId: "642ce142-0c32-4887-b3c3-ad8f2917a016",
          kind: "adult",
        },
      ],
      revision: 1,
      status: "proposed",
      turnId: "6988468e-41ad-4c63-8d40-03404fded846",
    },
  ],
  id: "e99e1dae-2005-4d66-9406-3176a9ec74fe",
  messages: [],
  scope: { _tag: "AccountPrivateSetup" },
  turns: [],
  version: 1,
});

const confirmationActionId = "00000000-0000-4000-8000-000000000101";
const confirmedConversationView = Schema.decodeUnknownSync(ConversationView)({
  ...conversationView,
  turns: [
    {
      failure: null,
      id: "00000000-0000-4000-8000-000000000102",
      setupConfirmation: {
        _tag: "ConfirmDisplayedRoster",
        actionId: confirmationActionId,
        blockId: conversationView.blocks[0]?.id,
        revision: 1,
      },
      status: "succeeded",
    },
  ],
});

const makeTransport = (
  mode: "unavailable" | "proposal" | "confirmation" = "unavailable"
) => {
  let family: object | null = null;
  let completed = 0;
  let loseActionResponse = false;
  let committedAction: ConversationAction | null = null;
  let failLeo = false;
  let denyFamily = false;
  const familyCreates: CreateFamily[] = [];
  const personCreates: CreateHouseholdPersonPayload[] = [];
  const creatorRenames: RenameHouseholdPersonPayload[] = [];
  const acceptedActions: ConversationAction[] = [];
  // eslint-disable-next-line complexity -- The fixture handles each independent setup endpoint in one transport.
  const transport = (async (input, init): Promise<Response> => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/get-session")) {
      return Response.json({
        session: {
          activeOrganizationId: family ? "family-1" : null,
          expiresAt: "2099-01-01T00:00:00Z",
          id: "session-1",
          userId: "adult-1",
        },
        user: { email: "alex@example.test", id: "adult-1", name: "Alex" },
      });
    }
    if (path === "/v1/agent-conversations/setup") {
      return mode === "unavailable"
        ? Response.json({ message: "Provider unavailable" }, { status: 503 })
        : Response.json({
            ...(mode === "confirmation"
              ? confirmedConversationView
              : conversationView),
            actions:
              committedAction === null
                ? []
                : [
                    {
                      action: committedAction,
                      state: {
                        _tag: "Committed",
                        actionId: committedAction.actionId,
                        familyId: "family-1",
                      },
                    },
                  ],
          });
    }
    if (
      path === "/v1/agent-conversations/setup/actions" &&
      request.method === "POST"
    ) {
      const action = Schema.decodeUnknownSync(ConversationAction)(
        await request.json()
      );
      acceptedActions.push(action);
      committedAction = action;
      if (action.decision !== "accept" || !action.reviewedRoster) {
        throw new Error("A reviewed roster is required.");
      }
      family = {
        canManage: true,
        createdAtEpochMs: 1,
        id: "family-1",
        name: action.reviewedRoster.familyName,
        setup: { status: "in_progress" },
        slug: "morgan-family",
        updatedAtEpochMs: 1,
        version: 1,
      };
      if (loseActionResponse) {
        loseActionResponse = false;
        throw new Error("The committed response was lost.");
      }
      return Response.json({
        _tag: "Committed",
        actionId: action.actionId,
        familyId: "family-1",
      });
    }
    if (path === "/v1/families" && request.method === "GET") {
      return Response.json(family ? [family] : []);
    }
    if (path === "/v1/families" && request.method === "POST") {
      const command = Schema.decodeUnknownSync(CreateFamily)(
        await request.json()
      );
      familyCreates.push(command);
      if (denyFamily) {
        return Response.json(
          { _tag: "FamilyForbidden", message: "Forbidden" },
          { status: 403 }
        );
      }
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
    if (path === "/v1/families/family-1") {
      return Response.json(family);
    }
    if (
      path === "/v1/families/family-1/complete-setup" &&
      request.method === "POST"
    ) {
      completed += 1;
      family = {
        ...family,
        setup: { completedAtEpochMs: 1, status: "complete" },
      };
      return Response.json(family);
    }
    if (path.endsWith("/organization/set-active")) {
      return Response.json(family);
    }
    if (path === "/v1/families/family-1/people" && request.method === "GET") {
      return Response.json({
        creatorSlot: "occupied",
        currentPersonId: creator.id,
        people: [creator],
      });
    }
    if (path === "/v1/families/family-1/people" && request.method === "POST") {
      const payload = Schema.decodeUnknownSync(CreateHouseholdPersonPayload)(
        await request.json()
      );
      personCreates.push(payload);
      if (failLeo && payload.displayName === "Leo") {
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
    if (
      path === `/v1/families/family-1/people/${creator.id}` &&
      request.method === "PATCH"
    ) {
      const payload = Schema.decodeUnknownSync(RenameHouseholdPersonPayload)(
        await request.json()
      );
      creatorRenames.push(payload);
      return Response.json({
        ...creator,
        displayName: payload.displayName,
        version: 2,
      });
    }
    throw new Error(`Unexpected fixture request: ${request.method} ${path}`);
  }) satisfies typeof fetch;
  return {
    acceptedActions,
    allowLeo: () => {
      failLeo = false;
    },
    blockLeo: () => {
      failLeo = true;
    },
    completed: () => completed,
    creatorRenames,
    denyFamily: () => {
      denyFamily = true;
    },
    familyCreates,
    loseNextActionResponse: () => {
      loseActionResponse = true;
    },
    personCreates,
    transport,
  };
};

const renderSetup = (
  fixture: ReturnType<typeof makeTransport>,
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
) => {
  vi.stubGlobal("fetch", fixture.transport);
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/setup/family"] }),
    routeTree: root.addChildren([
      createRoute({
        component: () => (
          <SetupProvider>
            <FamilySetupPage />
          </SetupProvider>
        ),
        getParentRoute: () => root,
        path: "/setup/family",
      }),
      createRoute({
        component: () => <h1>Review your family</h1>,
        getParentRoute: () => root,
        path: "/setup/review",
      }),
      createRoute({
        component: () => <h1>Food discovery</h1>,
        getParentRoute: () => root,
        path: "/",
      }),
    ]),
  });
  render(
    <MotionProvider>
      <QueryClientProvider client={queryClient}>
        <AuthClientContext value={makeAuthClient(fixture.transport)}>
          <ApiRuntimeContext value={browserApiRuntime()}>
            <RouterProvider router={router} />
          </ApiRuntimeContext>
        </AuthClientContext>
      </QueryClientProvider>
    </MotionProvider>
  );
  return userEvent.setup();
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("scrollTo", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("creates a reviewed manual family and child when chat is unavailable", async () => {
  const fixture = makeTransport();
  const user = renderSetup(fixture);
  const manualButton = await screen.findByRole("button", {
    name: "Add manually instead",
  });
  await waitFor(() => expect(manualButton).toBeEnabled());
  await user.click(manualButton);
  await screen.findByLabelText("Family name");
  await user.type(screen.getByLabelText("Family name"), "Murphy family");
  await user.clear(screen.getByLabelText("Your name"));
  await user.type(screen.getByLabelText("Your name"), "Alexandra");
  await user.click(screen.getByRole("button", { name: "Add someone" }));
  await user.type(screen.getByLabelText("Name", { exact: true }), "Maya");
  await user.click(screen.getByRole("button", { name: "Child" }));
  await user.click(screen.getByRole("button", { name: "Create our family" }));
  await screen.findByRole("heading", { name: "Review your family" });
  await waitFor(() => expect(fixture.familyCreates).toHaveLength(1));
  expect(fixture.creatorRenames).toMatchObject([{ displayName: "Alexandra" }]);
  expect(fixture.personCreates).toMatchObject([
    { displayName: "Maya", kind: "dependant" },
  ]);
});

it("saves the exact displayed roster on an explicit confirmation and opens food discovery", async () => {
  const fixture = makeTransport("confirmation");
  renderSetup(fixture);
  await screen.findByRole("heading", { name: "Food discovery" });
  expect(fixture.acceptedActions).toHaveLength(1);
  expect(fixture.acceptedActions[0]).toMatchObject({
    actionId: confirmationActionId,
    blockId: conversationView.blocks[0]?.id,
    decision: "accept",
    expectedRevision: 1,
    reviewedRoster: {
      creatorName: "Alex",
      familyName: "Murphy family",
      people: [{ displayName: "Sam", kind: "adult" }],
    },
  });
  expect(fixture.completed()).toBe(1);
  expect(fixture.familyCreates).toHaveLength(0);
  expect(fixture.personCreates).toHaveLength(0);
});

it("recovers a committed save after its response is lost and the page reloads", async () => {
  const fixture = makeTransport("confirmation");
  fixture.loseNextActionResponse();
  renderSetup(fixture);
  await screen.findByRole("button", { name: "Check save" });
  expect(fixture.acceptedActions).toHaveLength(1);
  expect(fixture.completed()).toBe(0);
  cleanup();
  renderSetup(fixture);
  await screen.findByRole("heading", { name: "Food discovery" });
  expect(fixture.acceptedActions).toHaveLength(1);
  expect(fixture.completed()).toBe(1);
});

it("shows the chat roster at the table and carries it into manual editing", async () => {
  const fixture = makeTransport("proposal");
  const user = renderSetup(fixture);
  await screen.findByRole("heading", { name: "Murphy family" });
  const table = screen.getByRole("region", { name: "Your family table" });
  expect(
    within(table).getByRole("heading", { name: "Murphy family" })
  ).toBeVisible();
  expect(
    within(table).getByRole("list", { name: "Family members" })
  ).toHaveTextContent("AlexYou");
  expect(
    within(table).getByRole("list", { name: "Family members" })
  ).toHaveTextContent("SamAdult");
  expect(screen.queryByLabelText("Family name")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create our family" })
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "Your message" }),
    "Could we add Rory?"
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Add manually instead" })
    ).toBeEnabled()
  );
  await user.click(
    screen.getByRole("button", { name: "Add manually instead" })
  );
  expect(await screen.findByLabelText("Family name")).toHaveValue(
    "Murphy family"
  );
  expect(
    screen.queryByRole("textbox", { name: "Your message" })
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Your name")).toHaveValue("Alex");
  await user.clear(screen.getByLabelText("Family name"));
  await user.type(screen.getByLabelText("Family name"), "Weekend family");
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Name", { exact: true })).toHaveValue("Sam");
  await user.clear(screen.getByLabelText("Name", { exact: true }));
  await user.type(screen.getByLabelText("Name", { exact: true }), "Samuel");
  await user.click(
    screen.getByRole("button", { name: "Return to conversation" })
  );
  expect(
    screen.queryByRole("textbox", { name: "Family name" })
  ).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Your message" })).toHaveValue(
    "Could we add Rory?"
  );
  expect(
    within(screen.getByRole("region", { name: "Your family table" })).getByRole(
      "heading",
      { name: "Murphy family" }
    )
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Add manually instead" })
  );
  expect(screen.getByRole("textbox", { name: "Family name" })).toHaveValue(
    "Weekend family"
  );
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Samuel");
  expect(fixture.familyCreates).toHaveLength(0);
});

it("keeps earlier people saved and retries the uncertain person with its original ID", async () => {
  const fixture = makeTransport();
  fixture.blockLeo();
  const user = renderSetup(fixture);
  const manualButton = await screen.findByRole("button", {
    name: "Add manually instead",
  });
  await waitFor(() => expect(manualButton).toBeEnabled());
  await user.click(manualButton);
  await user.type(screen.getByLabelText("Family name"), "Murphy family");
  await user.click(screen.getByRole("button", { name: "Add someone" }));
  await user.type(screen.getByLabelText("Name", { exact: true }), "Maya");
  await user.click(screen.getByRole("button", { name: "Add someone" }));
  await user.type(screen.getByLabelText("Name", { exact: true }), "Leo");
  await user.click(screen.getByRole("button", { name: "Add someone" }));
  await user.type(screen.getByLabelText("Name", { exact: true }), "Rory");
  await user.click(screen.getByRole("button", { name: "Create our family" }));
  await screen.findByText(
    /1 person is confirmed so far/u,
    {},
    { timeout: 10_000 }
  );
  expect(fixture.familyCreates).toHaveLength(1);
  expect(
    fixture.personCreates.filter((person) => person.displayName === "Maya")
  ).toHaveLength(1);
  const uncertain = fixture.personCreates.filter(
    (person) => person.displayName === "Leo"
  );
  expect(uncertain.length).toBeGreaterThan(0);
  fixture.allowLeo();
  await user.click(screen.getByRole("button", { name: "Check and continue" }));
  await screen.findByRole("heading", { name: "Review your family" });
  const retried = fixture.personCreates.filter(
    (person) => person.displayName === "Leo"
  );
  expect(new Set(retried.map((person) => person.mutationId)).size).toBe(1);
  expect(
    fixture.personCreates.filter((person) => person.displayName === "Rory")
  ).toHaveLength(1);
  expect(fixture.familyCreates).toHaveLength(1);
});

it("keeps the draft editable after a definite family permission rejection", async () => {
  const fixture = makeTransport();
  fixture.denyFamily();
  const user = renderSetup(fixture);
  const manualButton = await screen.findByRole("button", {
    name: "Add manually instead",
  });
  await waitFor(() => expect(manualButton).toBeEnabled());
  await user.click(manualButton);
  await user.type(screen.getByLabelText("Family name"), "Murphy family");
  await user.click(screen.getByRole("button", { name: "Create our family" }));
  await screen.findByText(/This account can’t create a family/u);
  expect(screen.getByLabelText("Family name")).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Create our family" })
  ).toBeEnabled();
  expect(fixture.familyCreates).toHaveLength(1);
});

it("continues from a confirmed family when its list refresh fails", async () => {
  class FailingListRefreshClient extends QueryClient {
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
  const user = renderSetup(fixture, new FailingListRefreshClient());
  const manualButton = await screen.findByRole("button", {
    name: "Add manually instead",
  });
  await waitFor(() => expect(manualButton).toBeEnabled());
  await user.click(manualButton);
  await user.type(screen.getByLabelText("Family name"), "Murphy family");
  await user.click(screen.getByRole("button", { name: "Create our family" }));
  await screen.findByRole("heading", { name: "Review your family" });
  expect(fixture.familyCreates).toHaveLength(1);
});
