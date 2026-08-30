import {
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPersonId,
} from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HouseholdPeoplePanel } from "./household-people-panel.js";
import { HouseholdPeopleOperationError } from "./operations.js";
import type {
  HouseholdPeopleOperationFailureCode,
  HouseholdPeopleOperations,
} from "./operations.js";

const failure = (code: HouseholdPeopleOperationFailureCode) =>
  new HouseholdPeopleOperationError(code);

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
    const archive = vi.fn().mockRejectedValue(failure("stale_version"));
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
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/changed\. Refresh the roster/u)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("does not describe a linked creator as an unlinked account", async () => {
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create: vi.fn(),
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    renderPanel(operations);

    expect(await screen.findByText("Cillian")).toBeInTheDocument();
    expect(screen.getByText(/you/u)).toBeInTheDocument();
    expect(screen.queryByText(/account remains unlinked/iu)).toBeNull();
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
    expect(screen.getByLabelText("Your name")).toBeDisabled();
  });

  it("freezes a pending create intent so visible fields cannot diverge from its command", async () => {
    let submittedDisplayName: string | undefined;
    const create: HouseholdPeopleOperations["create"] = vi.fn((payload) => {
      submittedDisplayName = payload.displayName;
      return new Promise<typeof HouseholdPerson.Type>(() => {});
    });
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create,
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    renderPanel(operations);
    const name = await screen.findByLabelText("Name");
    await userEvent.type(name, "Aoife");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(name).toBeDisabled();
    expect(screen.getByLabelText("Kind")).toBeDisabled();
    expect(name).toHaveValue("Aoife");
    expect(submittedDisplayName).toBe("Aoife");
  });

  it.each(["", "   ", "x".repeat(81)])(
    "shows schema-backed name validation and does not submit %j",
    async (displayName) => {
      const create = vi.fn();
      const operations: HouseholdPeopleOperations = {
        archive: vi.fn(),
        bootstrapCreator: vi.fn(),
        create,
        list: vi.fn().mockResolvedValue(roster),
        restore: vi.fn(),
      };
      renderPanel(operations);
      const name = await screen.findByLabelText("Name");
      if (displayName !== "") {
        await userEvent.type(name, displayName);
      }
      await userEvent.tab();
      await userEvent.click(screen.getByRole("button", { name: "Add person" }));
      expect(create).not.toHaveBeenCalled();
      expect(name).toHaveAttribute("aria-invalid", "true");
      expect(await screen.findByText(/name must/iu)).toBeInTheDocument();
    }
  );

  it("explains when an admitted non-owner cannot bootstrap the creator", async () => {
    const bootstrapCreator = vi
      .fn()
      .mockRejectedValue(failure("creator_required"));
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
      await screen.findByText(/only the household owner/iu)
    ).toBeInTheDocument();
  });

  it("retries a transient create with byte-identical variables", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(failure("people_unavailable"))
      .mockResolvedValueOnce(roster.people[0]);
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create,
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    renderPanel(operations);

    await userEvent.type(await screen.findByLabelText("Name"), "Aoife");
    await userEvent.selectOptions(screen.getByLabelText("Kind"), "adult");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[0]).toEqual(create.mock.calls[0]?.[0]);
  });

  it("retries an ambiguous committed create as the same user intent", async () => {
    const peopleByMutation = new Map<string, (typeof roster.people)[number]>();
    const attemptsByMutation = new Map<string, number>();
    const create = vi.fn(
      async (payload: Parameters<HouseholdPeopleOperations["create"]>[0]) => {
        const key = payload.mutationId;
        const person =
          peopleByMutation.get(key) ??
          Schema.decodeUnknownSync(HouseholdPerson)({
            createdAtEpochMs: 1,
            displayName: payload.displayName,
            id: personId,
            isCurrentAdult: false,
            kind: payload.kind,
            lifecycle: "active",
            updatedAtEpochMs: 1,
            version: 1,
          });
        peopleByMutation.set(key, person);
        const attempt = (attemptsByMutation.get(key) ?? 0) + 1;
        attemptsByMutation.set(key, attempt);
        if (attempt < 3) {
          throw failure("people_unavailable");
        }
        return person;
      }
    );
    const list = vi.fn(async () =>
      Schema.decodeUnknownSync(HouseholdPeopleRoster)({
        ...roster,
        people: [...peopleByMutation.values()],
      })
    );
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create,
      list,
      restore: vi.fn(),
    };
    renderPanel(operations);

    await userEvent.type(await screen.findByLabelText("Name"), "Aoife");
    await userEvent.selectOptions(screen.getByLabelText("Kind"), "adult");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));

    await userEvent.click(
      screen.getByRole("button", { name: "Retry adding this person" })
    );

    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    expect(create.mock.calls[2]?.[0]).toEqual(create.mock.calls[0]?.[0]);
    expect(peopleByMutation.size).toBe(1);
    expect(await screen.findByText("Aoife")).toBeInTheDocument();
  });

  it("abandons an ambiguous create intent when the user edits it", async () => {
    const create = vi.fn().mockRejectedValue(failure("people_unavailable"));
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create,
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    renderPanel(operations);

    const name = await screen.findByLabelText("Name");
    await userEvent.type(name, "Aoife");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const firstIntent = create.mock.calls[0]?.[0];

    await userEvent.type(name, " Murphy");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(4));
    expect(create.mock.calls[2]?.[0].mutationId).not.toBe(
      firstIntent?.mutationId
    );
    expect(create.mock.calls[2]?.[0].displayName).toBe("Aoife Murphy");
  });

  it("retries ambiguous creator bootstrap with its exact command", async () => {
    const bootstrapCreator = vi
      .fn()
      .mockRejectedValueOnce(failure("people_unavailable"))
      .mockRejectedValueOnce(failure("people_unavailable"))
      .mockResolvedValueOnce(roster.people[0]);
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
    await userEvent.click(
      screen.getByRole("button", { name: "Retry setting up my person" })
    );

    await waitFor(() => expect(bootstrapCreator).toHaveBeenCalledTimes(3));
    expect(bootstrapCreator.mock.calls[2]?.[0]).toEqual(
      bootstrapCreator.mock.calls[0]?.[0]
    );
  });

  it.each([
    {
      action: "archive" as const,
      button: "Archive",
      confirm: true,
      operationsRoster: roster,
      retry: "Retry archiving Cillian",
    },
    {
      action: "restore" as const,
      button: "Restore",
      confirm: false,
      operationsRoster: archivedRoster,
      retry: "Retry restoring Cillian",
    },
  ])(
    "retries an ambiguous $action with its exact command",
    async ({ action, button, confirm, operationsRoster, retry }) => {
      const transition = vi
        .fn()
        .mockRejectedValueOnce(failure("people_unavailable"))
        .mockRejectedValueOnce(failure("people_unavailable"))
        .mockResolvedValueOnce(operationsRoster.people[0]);
      const operations: HouseholdPeopleOperations = {
        archive: action === "archive" ? transition : vi.fn(),
        bootstrapCreator: vi.fn(),
        create: vi.fn(),
        list: vi.fn().mockResolvedValue(operationsRoster),
        restore: action === "restore" ? transition : vi.fn(),
      };
      renderPanel(operations);

      await userEvent.click(
        await screen.findByRole("button", { name: button })
      );
      if (confirm) {
        await userEvent.click(
          screen.getByRole("button", { name: "Confirm archive" })
        );
      }
      await waitFor(() => expect(transition).toHaveBeenCalledTimes(2));
      await userEvent.click(screen.getByRole("button", { name: retry }));

      await waitFor(() => expect(transition).toHaveBeenCalledTimes(3));
      expect(transition.mock.calls[2]).toEqual(transition.mock.calls[0]);
    }
  );

  it("reports an occupied creator slot as durable and does not retry it", async () => {
    const bootstrapCreator = vi
      .fn()
      .mockRejectedValue(failure("bootstrap_conflict"));
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
    [failure("unauthorized"), /no longer authorized/u],
    [failure("people_unavailable"), /temporarily unavailable/u],
  ])(
    "reports public roster failures honestly",
    async (operationError, message) => {
      const operations: HouseholdPeopleOperations = {
        archive: vi.fn(),
        bootstrapCreator: vi.fn(),
        create: vi.fn(),
        list: vi.fn().mockRejectedValue(operationError),
        restore: vi.fn(),
      };
      renderPanel(operations);
      expect(await screen.findByText(message)).toBeInTheDocument();
    }
  );
});
// @vitest-environment jsdom
