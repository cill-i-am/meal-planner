import {
  HouseholdPeopleRoster,
  HouseholdPersonId,
} from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HouseholdPeoplePanel } from "./household-people-panel.js";
import type { HouseholdPeopleOperations } from "./operations.js";

const personId = Schema.decodeUnknownSync(HouseholdPersonId)(
  "person_00000000-0000-4000-8000-000000000101"
);
const roster = Schema.decodeUnknownSync(HouseholdPeopleRoster)({
  creatorSlot: "occupied",
  currentPersonId: personId,
  people: [
    {
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
const emptyRoster = Schema.decodeUnknownSync(HouseholdPeopleRoster)({
  creatorSlot: "available",
  currentPersonId: null,
  people: [],
});
const unlinkedRoster = Schema.decodeUnknownSync(HouseholdPeopleRoster)({
  creatorSlot: "occupied",
  currentPersonId: null,
  people: [{ ...roster.people[0], isCurrentAdult: false }],
});
const unlinkedRosterBeforeCreatorBootstrap = Schema.decodeUnknownSync(
  HouseholdPeopleRoster
)({
  creatorSlot: "available",
  currentPersonId: null,
  people: [
    {
      ...roster.people[0],
      displayName: "Household dependant",
      isCurrentAdult: false,
      kind: "dependant",
    },
  ],
});
const archivedRoster = Schema.decodeUnknownSync(HouseholdPeopleRoster)({
  creatorSlot: "occupied",
  currentPersonId: personId,
  people: [{ ...roster.people[0], lifecycle: "archived", version: 2 }],
});

const renderPanel = (operations: HouseholdPeopleOperations) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retryDelay: 0 },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HouseholdPeoplePanel operations={operations} organizationId="org-a" />
    </QueryClientProvider>
  );
};

afterEach(cleanup);

describe("HouseholdPeoplePanel", () => {
  it("shows persisted identities and reports stale transitions without optimistic state", async () => {
    const archive = vi.fn().mockRejectedValue({ code: "stale_version" });
    const operations: HouseholdPeopleOperations = {
      archive,
      bootstrapCreator: vi.fn(),
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    renderPanel(operations);
    expect(await screen.findByText("Cillian")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm archive" })
    );
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(/changed\. Refresh the roster/u)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("requires confirmation before archiving", async () => {
    const archive = vi.fn();
    const operations: HouseholdPeopleOperations = {
      archive,
      bootstrapCreator: vi.fn(),
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    renderPanel(operations);
    expect(await screen.findByText("Cillian")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(archive).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Confirm archive" })
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("creates an explicit person and restores the persisted identity", async () => {
    const create = vi.fn().mockResolvedValue(roster.people[0]);
    const restore = vi.fn().mockResolvedValue(archivedRoster.people[0]);
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create,
      list: vi.fn().mockResolvedValue(archivedRoster),
      restore,
    };
    renderPanel(operations);
    expect(
      await screen.findByRole("button", { name: "Restore" })
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith(
        personId,
        expect.objectContaining({ expectedVersion: 2 })
      )
    );
    await userEvent.type(screen.getByLabelText("Name"), "Aoife");
    await userEvent.selectOptions(screen.getByLabelText("Kind"), "adult");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: "Aoife", kind: "adult" })
      )
    );
  });

  it("shows explicit bootstrap pending state and submits no optimistic identity", async () => {
    const bootstrapCreator = vi.fn(() => new Promise<never>(() => {}));
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator,
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(emptyRoster),
      restore: vi.fn(),
    };
    renderPanel(operations);
    await userEvent.type(await screen.findByLabelText("Your name"), "Maeve");
    await userEvent.click(
      screen.getByRole("button", { name: "Set up my person" })
    );
    expect(
      await screen.findByRole("button", { name: "Setting up…" })
    ).toBeDisabled();
    expect(
      screen.queryByText("Maeve", { selector: "strong" })
    ).not.toBeInTheDocument();
    expect(bootstrapCreator).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Maeve" })
    );
  });

  it("explains when an admitted non-owner cannot bootstrap the creator", async () => {
    const bootstrapCreator = vi
      .fn()
      .mockRejectedValue({ code: "creator_required" });
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator,
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(emptyRoster),
      restore: vi.fn(),
    };
    renderPanel(operations);
    await userEvent.type(await screen.findByLabelText("Your name"), "Maeve");
    await userEvent.click(
      screen.getByRole("button", { name: "Set up my person" })
    );
    await waitFor(() => expect(bootstrapCreator).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(/only the household owner/iu)
    ).toBeInTheDocument();
  });

  it("reports an occupied creator slot as durable and does not retry it", async () => {
    const bootstrapCreator = vi
      .fn()
      .mockRejectedValue({ code: "bootstrap_conflict" });
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator,
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(emptyRoster),
      restore: vi.fn(),
    };
    renderPanel(operations);
    await userEvent.type(await screen.findByLabelText("Your name"), "Maeve");
    await userEvent.click(
      screen.getByRole("button", { name: "Set up my person" })
    );
    await waitFor(() => expect(bootstrapCreator).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/already has a creator person/iu)
    ).toBeInTheDocument();
    expect(screen.queryByText(/temporarily unavailable/iu)).toBeNull();
    expect(screen.queryByText(/retry safely/iu)).toBeNull();
  });

  it("keeps an unlinked owner in a safe non-bootstrap state after another owner wins", async () => {
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(unlinkedRoster),
      restore: vi.fn(),
    };
    renderPanel(operations);

    expect(await screen.findByText("Cillian")).toBeInTheDocument();
    expect(screen.getByText(/account remains unlinked/iu)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Set up my person" })
    ).toBeNull();
    expect(screen.queryByText(/temporarily unavailable/iu)).toBeNull();
    expect(screen.queryByText(/retry safely/iu)).toBeNull();
  });

  it("offers creator bootstrap when only non-creator roster entries exist", async () => {
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(unlinkedRosterBeforeCreatorBootstrap),
      restore: vi.fn(),
    };
    renderPanel(operations);

    expect(await screen.findByText("Household dependant")).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set up my person" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/account remains unlinked/iu)).toBeNull();
  });

  it.each([
    [{ code: "unauthorized" }, /no longer authorized/u],
    [{ code: "people_unavailable" }, /temporarily unavailable/u],
  ])("reports public roster failures honestly", async (failure, message) => {
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create: vi.fn(),
      list: vi.fn().mockRejectedValue(failure),
      restore: vi.fn(),
    };
    renderPanel(operations);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
// @vitest-environment jsdom
