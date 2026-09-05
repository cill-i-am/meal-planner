// @vitest-environment jsdom
import { ProfileFact } from "@meal-planner/household-api";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";

import { ProfileFactForm } from "./profile-fact-form.js";

afterEach(cleanup);
const safetyFact = Schema.decodeUnknownSync(ProfileFact)({
  createdAtEpochMs: 1,
  createdBy: "a".repeat(64),
  createdInVersion: 1,
  id: "fact_00000000-0000-4000-8000-000000000101",
  source: "manual_ui",
  standing: { _tag: "confirmed", basis: "self" },
  updatedAtEpochMs: 1,
  updatedBy: "a".repeat(64),
  updatedInVersion: 1,
  value: {
    _tag: "HardConstraint",
    category: "allergen",
    handling: "exclude",
    label: "Peanuts",
  },
});

it("shows old and proposed safety meaning and requires explicit confirmation before removal", async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  render(
    <ProfileFactForm
      basis="self"
      disabled={false}
      fact={safetyFact}
      submit={submit}
    />
  );
  expect(
    screen.getByText(/Current safety meaning: Peanuts/u)
  ).toBeInTheDocument();
  const confirm = screen.getByRole("button", { name: "Confirm safety change" });
  expect(confirm).toBeDisabled();
  await user.click(
    screen.getByLabelText("Remove this safety fact instead of replacing it")
  );
  expect(
    screen.getByText(/Remove this fact. No replacement/u)
  ).toBeInTheDocument();
  expect(confirm).toBeDisabled();
  await user.click(
    screen.getByLabelText("I confirm this safety constraint change")
  );
  await user.click(confirm);
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    _tag: "ConfirmHardConstraintReduction",
    confirmation: "I confirm this safety constraint change",
    factId: safetyFact.id,
    replacement: null,
  });
});

it("does not offer implicit safety clearance as a provisional fact", async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  render(
    <ProfileFactForm basis="provisional" disabled={false} submit={submit} />
  );
  expect(
    screen.queryByRole("option", { name: "No known hard constraints" })
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Food or ingredient"), "Broccoli");
  await user.click(screen.getByRole("button", { name: "Add fact" }));
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    _tag: "AddProvisionalProfileFact",
    fact: {
      _tag: "FoodPreference",
      label: "Broccoli",
      sentiment: "like",
      targetKind: "ingredient",
    },
  });
});
