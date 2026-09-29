import {
  Fallback,
  HouseholdPerson,
  ManagedOccasion,
  PlanningContentSnapshot,
  Routine,
} from "@meal-planner/household-api";
import type { PlanningContentCommand } from "@meal-planner/household-api";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";

import { PlanningFoundations } from "./planning-foundations.js";

afterEach(cleanup);

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
const first = {
  cover: null,
  kind: "external",
  label: "Pasta",
  optionId: "option_001",
  optionVersion: 1,
  provider: null,
} as const;
const second = {
  cover: null,
  kind: "external",
  label: "Soup",
  optionId: "option_002",
  optionVersion: 1,
  provider: null,
} as const;
const occasion = Schema.decodeUnknownSync(ManagedOccasion)({
  label: "Dinner",
  occasionId: "dinner_001",
  personId: person.id,
  state: "managed",
  weekdays: [1, 3],
});
const base = Schema.decodeUnknownSync(PlanningContentSnapshot)({
  availability: [],
  configVersion: 1,
  cookingCapacity: {
    availableEquipment: [],
    maximumSubstantialCookEventsPerWeek: 0,
  },
  fallbacks: [],
  managedOccasions: [occasion],
  oneOffRoutines: [],
  options: [first, second],
  preparedPortions: [],
  routines: [],
  suitabilityReviews: [],
});
const renderPanel = (snapshot: PlanningContentSnapshot) => {
  const onCommand = vi.fn((_command: PlanningContentCommand) => {});
  render(
    <PlanningFoundations
      snapshot={snapshot}
      people={[person]}
      pending={false}
      onCommand={onCommand}
    />
  );
  return onCommand;
};
const panelFor = (title: string) => {
  const panel = screen.getByText(title).parentElement;
  if (!panel) {
    throw new Error(`${title} panel was not rendered`);
  }
  return panel;
};

it("updates one person's coverage while retaining occasion identity, days and custom meals", async () => {
  const user = userEvent.setup();
  const custom = Schema.decodeUnknownSync(ManagedOccasion)({
    label: "After school",
    occasionId: "snack_001",
    personId: person.id,
    state: "managed",
    weekdays: [2, 4],
  });
  const onCommand = renderPanel(
    PlanningContentSnapshot.make({
      ...base,
      managedOccasions: [occasion, custom],
    })
  );
  const coverage = panelFor("Meals we manage.");
  await user.click(within(coverage).getByRole("checkbox", { name: "Dinner" }));
  await user.click(
    within(coverage).getByRole("button", { name: "Save Alex’s meals" })
  );
  await waitFor(() => expect(onCommand).toHaveBeenCalledOnce());
  expect(onCommand.mock.calls[0]?.[0]).toMatchObject({
    _tag: "SetPersonManagedOccasions",
    entries: [
      { occasionId: "dinner_001", state: "disabled", weekdays: [1, 3] },
      {
        label: "After school",
        occasionId: "snack_001",
        state: "managed",
        weekdays: [2, 4],
      },
    ],
    personId: person.id,
  });
});

it("edits and pauses a saved routine with its original identity and next version", async () => {
  const user = userEvent.setup();
  const routine = Schema.decodeUnknownSync(Routine)({
    choice: {
      _tag: "Options",
      optionRefs: [
        { kind: "external", optionId: first.optionId, optionVersion: 1 },
      ],
      selection: "pin",
    },
    id: "routine_001",
    occasionId: occasion.occasionId,
    scope: { _tag: "Household" },
    state: "active",
    version: 3,
    weekdays: [1],
  });
  const onCommand = renderPanel(
    PlanningContentSnapshot.make({ ...base, routines: [routine] })
  );
  const saved = panelFor("Saved routines");
  await user.click(within(saved).getByRole("button", { name: "Edit" }));
  const form = screen
    .getByRole("button", { name: "Update routine" })
    .closest("form");
  if (!form) {
    throw new Error("Routine form was not rendered");
  }
  await user.selectOptions(
    within(form).getByLabelText("Saved food"),
    second.optionId
  );
  await user.click(
    within(form).getByRole("button", { name: "Update routine" })
  );
  await waitFor(() => expect(onCommand).toHaveBeenCalledOnce());
  expect(onCommand.mock.calls[0]?.[0]).toMatchObject({
    _tag: "PutRoutine",
    value: {
      choice: { optionRefs: [{ optionId: second.optionId }] },
      id: "routine_001",
      state: "active",
      version: 4,
    },
  });
  await user.click(within(saved).getByRole("button", { name: "Pause" }));
  expect(onCommand.mock.calls[1]?.[0]).toMatchObject({
    _tag: "PutRoutine",
    value: { id: "routine_001", state: "paused", version: 4 },
  });
});

it("blocks a new routine that overlaps an active rule", async () => {
  const user = userEvent.setup();
  const routine = Schema.decodeUnknownSync(Routine)({
    choice: {
      _tag: "Options",
      optionRefs: [
        { kind: "external", optionId: first.optionId, optionVersion: 1 },
      ],
      selection: "pin",
    },
    id: "routine_001",
    occasionId: occasion.occasionId,
    scope: { _tag: "Household" },
    state: "active",
    version: 1,
    weekdays: [1],
  });
  const onCommand = renderPanel(
    PlanningContentSnapshot.make({ ...base, routines: [routine] })
  );
  await user.click(screen.getByRole("button", { name: "Save routine" }));
  expect(
    await screen.findByText(/overlaps another active routine/u)
  ).toBeVisible();
  expect(onCommand).not.toHaveBeenCalled();
});

it("assigns a distinct fallback priority and edits or pauses an existing fallback", async () => {
  const user = userEvent.setup();
  const fallback = Schema.decodeUnknownSync(Fallback)({
    id: "fallback_001",
    locations: [],
    occasionIds: [occasion.occasionId],
    optionRef: { kind: "external", optionId: first.optionId, optionVersion: 1 },
    personId: person.id,
    priority: 1,
    state: "active",
    substitutionPolicy: "ask",
    version: 2,
  });
  const onCommand = renderPanel(
    PlanningContentSnapshot.make({ ...base, fallbacks: [fallback] })
  );
  const form = screen
    .getByRole("button", { name: "Save fallback" })
    .closest("form");
  if (!form) {
    throw new Error("Fallback form was not rendered");
  }
  await user.selectOptions(
    within(form).getByLabelText("Saved food"),
    second.optionId
  );
  await user.click(within(form).getByRole("button", { name: "Save fallback" }));
  await waitFor(() => expect(onCommand).toHaveBeenCalledOnce());
  expect(onCommand.mock.calls[0]?.[0]).toMatchObject({
    _tag: "PutFallback",
    value: {
      optionRef: { optionId: second.optionId },
      priority: 2,
      version: 1,
    },
  });
  const saved = panelFor("Saved fallbacks");
  await user.click(within(saved).getByRole("button", { name: "Edit" }));
  await user.selectOptions(
    within(form).getByLabelText("Saved food"),
    second.optionId
  );
  await user.click(
    within(form).getByRole("button", { name: "Update fallback" })
  );
  await waitFor(() => expect(onCommand).toHaveBeenCalledTimes(2));
  expect(onCommand.mock.calls[1]?.[0]).toMatchObject({
    _tag: "PutFallback",
    value: { id: "fallback_001", priority: 1, version: 3 },
  });
  await user.click(within(saved).getByRole("button", { name: "Pause" }));
  expect(onCommand.mock.calls[2]?.[0]).toMatchObject({
    _tag: "PutFallback",
    value: { id: "fallback_001", state: "paused", version: 3 },
  });
});
