import { PlanningContentSnapshot } from "@meal-planner/household-api";
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

import { PreparedFoodPanel } from "./prepared-food-panel.js";

afterEach(cleanup);

const option = {
  cover: null,
  kind: "external",
  label: "Pasta takeaway",
  optionId: "option_001",
  optionVersion: 1,
  provider: null,
} as const;

const snapshot = (withPortion = false) =>
  Schema.decodeUnknownSync(PlanningContentSnapshot)({
    availability: [],
    configVersion: 0,
    cookingCapacity: {
      availableEquipment: [],
      maximumSubstantialCookEventsPerWeek: 0,
    },
    fallbacks: [],
    managedOccasions: [],
    oneOffRoutines: [],
    options: [option],
    preparedPortions: withPortion
      ? [
          {
            confirmedForWeekStart: null,
            id: "portion_001",
            label: "Leftover pasta",
            lastCorrectionReason: "Recorded yesterday",
            quantity: {
              _tag: "Known",
              amount: 2,
              sourceText: null,
              unit: "portion",
            },
            remainingAmount: 1,
            reservations: [],
            sourceCookEventId: null,
            sourceOptionRef: null,
            state: "available",
            storage: "fridge",
            version: 1,
          },
        ]
      : [],
    routines: [],
    suitabilityReviews: [],
  });

it("shows a failed record beside the record form when no portions exist", async () => {
  const user = userEvent.setup();
  const onCommand = vi.fn((_command: PlanningContentCommand) => {});
  render(
    <PreparedFoodPanel
      snapshot={snapshot()}
      pending={false}
      onCommand={onCommand}
    />
  );

  await user.type(screen.getByLabelText("What is it?"), "Leftover pasta");
  await user.type(screen.getByLabelText("Amount now"), "0");
  await user.type(screen.getByLabelText("What was recorded?"), "Cooked today");
  await user.click(
    screen.getByRole("button", { name: "Record prepared food" })
  );

  expect(await screen.findByText(/positive amount/u)).toBeVisible();
  expect(onCommand).not.toHaveBeenCalled();
});

it("links existing manual portions to the exact saved option with a correction reason", async () => {
  const user = userEvent.setup();
  const onCommand = vi.fn((_command: PlanningContentCommand) => {});
  render(
    <PreparedFoodPanel
      snapshot={snapshot(true)}
      pending={false}
      onCommand={onCommand}
    />
  );

  const linkForm = screen
    .getByRole("button", { name: "Link saved food" })
    .closest("form");
  if (!linkForm) {
    throw new Error("Link form was not rendered");
  }
  await user.selectOptions(
    within(linkForm).getByLabelText("Prepared food"),
    "portion_001"
  );
  await user.selectOptions(
    within(linkForm).getByLabelText("Saved food made"),
    option.optionId
  );
  await user.type(
    within(linkForm).getByLabelText("Correction note"),
    "Matched saved takeaway"
  );
  await user.click(screen.getByRole("button", { name: "Link saved food" }));

  await waitFor(() => expect(onCommand).toHaveBeenCalledOnce());
  expect(onCommand.mock.calls[0]?.[0]).toMatchObject({
    _tag: "PutPreparedPortion",
    value: {
      id: "portion_001",
      reason: "Matched saved takeaway",
      sourceOptionRef: {
        kind: "external",
        optionId: option.optionId,
        optionVersion: 1,
      },
      version: 2,
    },
  });
});
