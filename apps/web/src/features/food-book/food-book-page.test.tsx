import {
  HouseholdPerson,
  MutatePlanningContentPayload,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { MotionProvider } from "../../components/ui/motion-provider.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ApiRuntimeContext } from "../api-client/index.js";
import { parseDisplayedIdentity } from "../auth/index.js";
import { familyKeys } from "../family/index.js";
import { FoodBookPage } from "./food-book-page.js";
import { foodBookKey } from "./operations.js";

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
const snapshot = Schema.decodeUnknownSync(PlanningContentSnapshot)({
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

it("keeps Add meal closed until a managed-meals save has settled", async () => {
  const delayedSave = Promise.withResolvers<Response>();
  const commands: MutatePlanningContentPayload[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === "/v1/planning-content" && request.method === "POST") {
      const command = Schema.decodeUnknownSync(MutatePlanningContentPayload)(
        await request.json()
      );
      commands.push(command);
      if (command.command._tag === "SetManagedOccasions") {
        return delayedSave.promise;
      }
      if (command.command._tag === "PutOption") {
        const [managed] = commands;
        if (managed?.command._tag !== "SetManagedOccasions") {
          throw new Error("Managed meals must be saved first.");
        }
        return Response.json({
          ...snapshot,
          configVersion: 3,
          managedOccasions: managed.command.entries,
          options: [command.command.value],
        });
      }
      throw new Error("Unexpected Food book command.");
    }
    return Response.json(
      { message: "Not needed for this test" },
      { status: 503 }
    );
  };
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  queryClient.setQueryData(foodBookKey(scope), snapshot);
  queryClient.setQueryData(
    familyKeys.people(scope.userId, scope.organizationId),
    { people: [person] }
  );
  queryClient.setQueryData(
    ["our-tastes-roster", scope.userId, scope.organizationId],
    { people: [person] }
  );
  const root = createRootRoute({
    component: () => <FoodBookPage scope={scope} />,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: root,
  });
  const user = userEvent.setup();
  render(
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

  await user.click(
    await screen.findByRole("button", { name: "Save managed meals" })
  );
  await waitFor(() => expect(commands).toHaveLength(1));
  const addMeal = screen.getByRole("button", { name: "Add a meal" });
  const emptyStateAdd = screen.getByRole("button", {
    name: "Add a familiar meal",
  });
  expect(addMeal).toBeDisabled();
  expect(emptyStateAdd).toBeDisabled();
  await user.click(addMeal);
  expect(screen.queryByText("Add a familiar choice.")).not.toBeInTheDocument();

  const [command] = commands;
  if (command?.command._tag !== "SetManagedOccasions") {
    throw new Error("The managed-meals request was not sent.");
  }
  delayedSave.resolve(
    Response.json({
      ...snapshot,
      configVersion: 2,
      managedOccasions: command.command.entries,
    })
  );
  await waitFor(() => expect(addMeal).toBeEnabled());
  await user.click(addMeal);
  expect(
    await screen.findByRole("heading", { name: "Add a familiar choice." })
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Eating out" }));
  await user.type(
    screen.getByRole("textbox", { name: "What do you call it?" }),
    "Friday takeaway"
  );
  await user.click(screen.getByRole("button", { name: "Save meal" }));
  await waitFor(() => expect(commands).toHaveLength(2));
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Add a familiar choice." })
    ).not.toBeInTheDocument()
  );
});
