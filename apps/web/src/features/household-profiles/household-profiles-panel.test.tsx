// @vitest-environment jsdom
import {
  HouseholdPeopleRoster,
  PersonProfile,
} from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";

import { HouseholdProfilesPanel } from "./household-profiles-panel.js";
import { ProfileOperationError } from "./operations.js";

const personId = "person_00000000-0000-4000-8000-000000000101";
const roster = Schema.decodeUnknownSync(HouseholdPeopleRoster)({
  creatorSlot: "occupied",
  currentPersonId: personId,
  people: [
    {
      associationState: "linked",
      associationVersion: 1,
      createdAtEpochMs: 1,
      displayName: "Cillian",
      id: personId,
      isCurrentAdult: true,
      kind: "adult",
      lifecycle: "active",
      updatedAtEpochMs: 1,
      version: 1,
    },
  ],
});
const empty = Schema.decodeUnknownSync(PersonProfile)({
  audit: null,
  facts: [],
  personId,
  version: 0,
});
afterEach(cleanup);

it("retains one ambiguous command across edits and remount, retrying its exact payload", async () => {
  const user = userEvent.setup();
  const mutate = vi
    .fn()
    .mockRejectedValue(new ProfileOperationError("ambiguous"));
  const operations = {
    get: vi.fn().mockResolvedValue(empty),
    mutate,
    versions: vi
      .fn()
      .mockResolvedValue({ nextBeforeVersion: null, versions: [] }),
  };
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const view = () => (
    <QueryClientProvider client={queryClient}>
      <HouseholdProfilesPanel
        organizationId="household-a"
        operations={operations}
        peopleOperations={{ list: vi.fn().mockResolvedValue(roster) }}
      />
    </QueryClientProvider>
  );
  const first = render(view());
  await screen.findByRole("heading", { name: "Cillian’s food profile" });
  await user.type(
    await screen.findByLabelText("Food or ingredient"),
    "Broccoli"
  );
  await user.click(screen.getByRole("button", { name: "Add fact" }));
  await screen.findByText(/outcome is not known/u);
  expect(mutate).toHaveBeenCalledTimes(1);
  const [original] = mutate.mock.calls;
  expect(screen.getByRole("button", { name: "Add fact" })).toBeDisabled();
  first.unmount();
  render(view());
  await screen.findByText(/outcome is not known/u);
  await user.click(screen.getByRole("button", { name: "Retry saved change" }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  expect(mutate.mock.calls[1]).toEqual(original);
  expect(
    screen.queryByRole("button", { name: /discard/iu })
  ).not.toBeInTheDocument();
});

it("requires reload and explicit reapplication after a stale version without automatic redispatch", async () => {
  const user = userEvent.setup();
  const mutate = vi
    .fn()
    .mockRejectedValue(new ProfileOperationError("stale_version"));
  const get = vi.fn().mockResolvedValue(empty);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <HouseholdProfilesPanel
        organizationId="household-stale"
        operations={{
          get,
          mutate,
          versions: vi
            .fn()
            .mockResolvedValue({ nextBeforeVersion: null, versions: [] }),
        }}
        peopleOperations={{ list: vi.fn().mockResolvedValue(roster) }}
      />
    </QueryClientProvider>
  );
  await user.type(
    await screen.findByLabelText("Food or ingredient"),
    "Carrots"
  );
  await user.click(screen.getByRole("button", { name: "Add fact" }));
  await screen.findByText(/This profile changed/u);
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Add fact" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Retry saved change" })
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reload profile" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Add fact" })).toBeEnabled()
  );
  expect(mutate).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Add fact" }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  const [first, second] = mutate.mock.calls;
  expect(second).not.toEqual(first);
});
