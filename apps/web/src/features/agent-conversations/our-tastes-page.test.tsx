import {
  HouseholdOrganizationId,
  HouseholdPeopleRoster,
  UserId,
} from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Effect, Schema } from "effect";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { ApiRuntimeContext } from "../api-client/index.js";
import { familyKeys } from "../family/index.js";
import { FamilyConversationPanel } from "./our-tastes-page.js";

const rosterState = vi.hoisted(() => ({
  current: null as unknown,
  fail: false,
}));

vi.mock("../household-people/index.js", () => ({
  makeHouseholdPeopleEffectOperations: () => ({
    list: () =>
      rosterState.fail
        ? Effect.fail(new Error("Roster unavailable"))
        : Effect.succeed(rosterState.current),
  }),
}));

vi.mock("../family/index.js", async () => {
  const familyOperations = await import("../family/family-operations.js");
  const peopleQueries = await import("../family/people-queries.js");
  return {
    familyKeys: familyOperations.familyKeys,
    familyRosterQueryOptions: peopleQueries.familyRosterQueryOptions,
  };
});

vi.mock("../food-book/index.js", () => ({
  PlanningContentProposalReviewSheet: () => null,
  usePlanningContentSnapshot: () => ({ data: null, isError: false }),
}));

vi.mock("../household-profiles/index.js", () => ({
  HouseholdProfilesPanel: () => null,
  invalidateHouseholdProfiles: () => Promise.resolve(),
  makeHouseholdProfileEffectOperations: () => ({}),
}));

vi.mock("../private-interviews/index.js", () => ({
  PrivateInterviewsPanel: () => null,
}));

vi.mock("./conversation-controller.js", () => ({
  AgentConversationProvider: ({ children }: { children: ReactNode }) =>
    children,
  useAgentConversation: () => ({}),
}));

vi.mock("./conversation-surface.js", () => ({
  ConversationSurface: ({
    people,
  }: {
    people: readonly { readonly displayName: string }[];
  }) => (
    <div data-testid="family-conversation">
      {people.map((person) => person.displayName).join(", ")}
    </div>
  ),
}));

const scope = {
  organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
    "00000000-0000-4000-8000-000000000011"
  ),
  userId: Schema.decodeUnknownSync(UserId)(
    "00000000-0000-4000-8000-000000000010"
  ),
};
const personId = "person_00000000-0000-4000-8000-000000000012";
const rosterNamed = (displayName: string) =>
  Schema.decodeUnknownSync(HouseholdPeopleRoster)({
    creatorSlot: "occupied",
    currentPersonId: null,
    people: [
      {
        associationState: "unlinked",
        associationVersion: 1,
        createdAtEpochMs: 1,
        displayName,
        id: personId,
        isCurrentAdult: false,
        kind: "dependant",
        lifecycle: "active",
        updatedAtEpochMs: 1,
        version: 1,
      },
    ],
  });

afterEach(() => {
  cleanup();
  rosterState.fail = false;
});

it("refreshes the conversation roster after a family person change and blocks review on a failed refresh", async () => {
  rosterState.current = rosterNamed("Maya");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ApiRuntimeContext.Provider
        value={{ baseUrl: "http://localhost", fetch: globalThis.fetch }}
      >
        <FamilyConversationPanel scope={scope} />
      </ApiRuntimeContext.Provider>
    </QueryClientProvider>
  );
  await waitFor(() =>
    expect(screen.getByTestId("family-conversation")).toHaveTextContent("Maya")
  );

  rosterState.current = rosterNamed("Mia");
  await client.invalidateQueries({
    queryKey: familyKeys.people(scope.userId, scope.organizationId),
  });
  await waitFor(() =>
    expect(screen.getByTestId("family-conversation")).toHaveTextContent("Mia")
  );

  rosterState.fail = true;
  await client.invalidateQueries({
    queryKey: familyKeys.people(scope.userId, scope.organizationId),
  });
  await waitFor(() =>
    expect(
      screen.getByText("Your family roster could not be loaded.")
    ).toBeVisible()
  );
  expect(screen.queryByTestId("family-conversation")).not.toBeInTheDocument();
  client.clear();
});
