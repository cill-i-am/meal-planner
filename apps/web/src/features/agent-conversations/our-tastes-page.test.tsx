import { ConversationView } from "@meal-planner/agent-conversations-api";
import {
  HouseholdOrganizationId,
  HouseholdPeopleRoster,
  PlanningContentSnapshot,
  UserId,
} from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Schema } from "effect";
import { afterEach, expect, it } from "vitest";

import { MotionProvider } from "../../components/ui/motion-provider.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ApiRuntimeContext } from "../api-client/index.js";
import { familyKeys } from "../family/index.js";
import { FamilyConversationPanel } from "./our-tastes-page.js";

const familyId = "00000000-0000-4000-8000-000000000011";
const childId = "person_00000000-0000-4000-8000-000000000012";
const adultId = "person_00000000-0000-4000-8000-000000000013";
const scope = {
  organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(familyId),
  userId: Schema.decodeUnknownSync(UserId)(
    "00000000-0000-4000-8000-000000000010"
  ),
};
const rosterNamed = (displayName: string) =>
  Schema.decodeUnknownSync(HouseholdPeopleRoster)({
    creatorSlot: "occupied",
    currentPersonId: adultId,
    people: [
      {
        associationState: "linked",
        associationVersion: 1,
        createdAtEpochMs: 1,
        displayName: "Alex",
        id: adultId,
        isCurrentAdult: true,
        kind: "adult",
        lifecycle: "active",
        updatedAtEpochMs: 1,
        version: 1,
      },
      {
        associationState: "unlinked",
        associationVersion: 1,
        createdAtEpochMs: 1,
        displayName,
        id: childId,
        isCurrentAdult: false,
        kind: "dependant",
        lifecycle: "active",
        updatedAtEpochMs: 1,
        version: 1,
      },
    ],
  });
const conversation = Schema.decodeUnknownSync(ConversationView)({
  actions: [],
  blocks: [
    {
      _tag: "PersonFactProposal",
      change: {
        _tag: "Remove",
        factId: "fact_00000000-0000-4000-8000-000000000017",
      },
      explanation: "The family can review this change.",
      id: "00000000-0000-4000-8000-000000000018",
      personId: childId,
      profileVersion: 1,
      requiresSafetyConfirmation: true,
      reviewedBefore: {
        _tag: "HardConstraint",
        category: "allergen",
        handling: "exclude",
        label: "Peanuts",
      },
      revision: 1,
      status: "proposed",
      turnId: "00000000-0000-4000-8000-000000000016",
    },
  ],
  id: "00000000-0000-4000-8000-000000000015",
  messages: [],
  scope: { _tag: "FamilyShared", familyId },
  turns: [],
  version: 0,
});
const planningContent = Schema.decodeUnknownSync(PlanningContentSnapshot)({
  availability: [],
  configVersion: 1,
  cookingCapacity: {
    availableEquipment: [],
    maximumSubstantialCookEventsPerWeek: 0,
  },
  fallbacks: [],
  managedOccasions: [],
  oneOffRoutines: [],
  options: [],
  preparedPortions: [],
  routines: [],
  suitabilityReviews: [],
});

afterEach(() => {
  cleanup();
  globalThis.sessionStorage.clear();
});

const renderPanel = (state: {
  roster: ReturnType<typeof rosterNamed>;
  unavailable: boolean;
}) => {
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === `/v1/families/${familyId}/people`) {
      return state.unavailable
        ? Response.json({ message: "Roster unavailable" }, { status: 403 })
        : Response.json(state.roster);
    }
    if (path === `/v1/families/${familyId}/agent-conversation`) {
      return Response.json(conversation);
    }
    if (path === "/v1/planning-content") {
      return Response.json(planningContent);
    }
    throw new Error(`Unexpected request: ${request.method} ${path}`);
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ApiRuntimeContext
        value={{ baseUrl: window.location.origin, fetch: transport }}
      >
        <MotionProvider>
          <TooltipProvider>
            <FamilyConversationPanel scope={scope} />
          </TooltipProvider>
        </MotionProvider>
      </ApiRuntimeContext>
    </QueryClientProvider>
  );
  return client;
};

it("refreshes the conversation roster after a family person change", async () => {
  const state = { roster: rosterNamed("Maya"), unavailable: false };
  const client = renderPanel(state);
  await waitFor(() =>
    expect(screen.getByText("A food fact for Maya")).toBeVisible()
  );
  expect(
    screen.getByRole("button", { name: "Review food fact" })
  ).toBeEnabled();

  state.roster = rosterNamed("Mia");
  await client.invalidateQueries({
    queryKey: familyKeys.people(scope.userId, scope.organizationId),
  });
  await waitFor(() =>
    expect(screen.getByText("A food fact for Mia")).toBeVisible()
  );
  client.clear();
});

it("blocks fact review when a roster refresh fails after showing a proposal", async () => {
  const state = { roster: rosterNamed("Maya"), unavailable: false };
  const client = renderPanel(state);
  await waitFor(() =>
    expect(screen.getByText("A food fact for Maya")).toBeVisible()
  );
  expect(
    screen.getByRole("button", { name: "Review food fact" })
  ).toBeEnabled();

  state.unavailable = true;
  await client.invalidateQueries({
    queryKey: familyKeys.people(scope.userId, scope.organizationId),
  });
  await waitFor(() =>
    expect(
      screen.getByText("Your family roster could not be loaded.")
    ).toBeVisible()
  );
  expect(
    screen.queryByRole("button", { name: "Review food fact" })
  ).not.toBeInTheDocument();
  client.clear();
});
