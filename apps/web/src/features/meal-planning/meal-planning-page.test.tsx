import {
  CreateMealPlanPayload,
  HouseholdPerson,
  ManagedOccasion,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, expect, it } from "vitest";

import { MotionProvider } from "../../components/ui/motion-provider.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ApiRuntimeContext } from "../api-client/index.js";
import { parseDisplayedIdentity } from "../auth/index.js";
import { familyKeys } from "../family/index.js";
import { foodBookKey } from "../food-book/operations.js";
import { MealPlanningPage } from "./meal-planning-page.js";
import { mealPlanKey } from "./operations.js";

const scope = parseDisplayedIdentity({
  organizationId: "synthetic-family",
  userId: "synthetic-user",
});
const person = Schema.decodeUnknownSync(HouseholdPerson)({
  associationState: "unlinked",
  associationVersion: null,
  createdAtEpochMs: 1,
  displayName: "Alex",
  id: "person_123e4567-e89b-42d3-a456-426614174000",
  isCurrentAdult: true,
  kind: "adult",
  lifecycle: "active",
  updatedAtEpochMs: 1,
  version: 1,
});
const occasion = Schema.decodeUnknownSync(ManagedOccasion)({
  label: "Dinner",
  occasionId: "dinner_001",
  personId: person.id,
  state: "managed",
  weekdays: [1, 3],
});
const snapshot = Schema.decodeUnknownSync(PlanningContentSnapshot)({
  availability: [],
  configVersion: 1,
  cookingCapacity: {
    availableEquipment: [],
    maximumSubstantialCookEventsPerWeek: 0,
  },
  fallbacks: [],
  managedOccasions: [occasion],
  oneOffRoutines: [],
  options: [],
  preparedPortions: [],
  routines: [],
  suitabilityReviews: [],
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

it("restores a lost create response after remount and retries the original request key", async () => {
  sessionStorage.clear();
  const requests: CreateMealPlanPayload[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (
      new URL(request.url).pathname === "/v1/meal-plans" &&
      request.method === "POST"
    ) {
      requests.push(
        Schema.decodeUnknownSync(CreateMealPlanPayload)(await request.json())
      );
      throw new TypeError("Response lost after commit");
    }
    return Response.json([]);
  };
  const mount = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    queryClient.setQueryData([...mealPlanKey(scope), "list"], []);
    queryClient.setQueryData(foodBookKey(scope), snapshot);
    queryClient.setQueryData(
      familyKeys.people(scope.userId, scope.organizationId),
      { people: [person] }
    );
    const root = createRootRoute({
      component: () => <MealPlanningPage scope={scope} />,
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: root,
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <ApiRuntimeContext
          value={{ baseUrl: window.location.origin, fetch: transport }}
        >
          <MotionProvider>
            <TooltipProvider>
              <RouterProvider router={router} />
            </TooltipProvider>
          </MotionProvider>
        </ApiRuntimeContext>
      </QueryClientProvider>
    );
  };
  const first = mount();
  await userEvent
    .setup()
    .click(
      await screen.findByRole("button", { name: "Create the first draft" })
    );
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Create draft" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  await screen.findByText("Save result unknown");
  first.unmount();

  mount();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Retry same request" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toEqual(requests[0]);
});
