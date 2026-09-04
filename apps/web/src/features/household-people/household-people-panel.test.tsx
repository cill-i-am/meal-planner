import {
  HouseholdMemberDepartureOperation,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPersonId,
} from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((_resolve) => {
    resolve = _resolve;
  });
  return { promise, resolve };
};

const personId = Schema.decodeUnknownSync(HouseholdPersonId)(
  "person_00000000-0000-4000-8000-000000000101"
);
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
const emptyRoster = Schema.decodeUnknownSync(HouseholdPeopleRoster)({
  creatorSlot: "available",
  currentPersonId: null,
  people: [],
});
const unlinkedRoster = Schema.decodeUnknownSync(HouseholdPeopleRoster)({
  creatorSlot: "occupied",
  currentPersonId: null,
  people: [
    {
      ...roster.people[0],
      associationState: "unlinked",
      associationVersion: null,
      isCurrentAdult: false,
    },
  ],
});
const unlinkedRosterBeforeCreatorBootstrap = Schema.decodeUnknownSync(
  HouseholdPeopleRoster
)({
  creatorSlot: "available",
  currentPersonId: null,
  people: [
    {
      ...roster.people[0],
      associationState: "unlinked",
      associationVersion: null,
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
const unlinkedArchivedRosterBeforeCreatorBootstrap = Schema.decodeUnknownSync(
  HouseholdPeopleRoster
)({
  ...unlinkedRosterBeforeCreatorBootstrap,
  people: [
    {
      ...unlinkedRosterBeforeCreatorBootstrap.people[0],
      lifecycle: "archived",
      version: 2,
    },
  ],
});
const departureOperationId = "departure_00000000-0000-4000-8000-000000000201";
const departureOperation = (
  state: (typeof HouseholdMemberDepartureOperation.Type)["state"],
  version: number,
  canRetry = false
) =>
  Schema.decodeUnknownSync(HouseholdMemberDepartureOperation)({
    canRetry,
    executionGeneration: 1,
    lastAttemptAtEpochMs: state === "prepared" ? null : 2,
    operationId: departureOperationId,
    personId,
    state,
    version,
  });

const renderPanel = (
  operations: HouseholdPeopleOperations,
  currentMemberId?: string
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retryDelay: 0 },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HouseholdPeoplePanel
        {...(currentMemberId === undefined ? {} : { currentMemberId })}
        operations={operations}
        organizationId="org-a"
      />
    </QueryClientProvider>
  );
};

afterEach(() => {
  cleanup();
  globalThis.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("HouseholdPeoplePanel", () => {
  it("selects an existing adult before inviting and never renders the submitted email", async () => {
    const inviteAdult = vi.fn().mockResolvedValue({
      association: "associated",
      invitationId: "invitation-a",
      person: {
        ...unlinkedRoster.people[0],
        associationState: "invitation_pending",
        associationVersion: 1,
      },
    });
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create: vi.fn(),
      inviteAdult,
      list: vi.fn().mockResolvedValue(unlinkedRoster),
      restore: vi.fn(),
    };
    renderPanel(operations);
    await userEvent.selectOptions(
      await screen.findByLabelText("Person"),
      personId
    );
    await userEvent.type(screen.getByLabelText("Email"), "adult@example.test");
    await userEvent.click(
      screen.getByRole("button", { name: "Send invitation" })
    );
    await waitFor(() => expect(inviteAdult).toHaveBeenCalledTimes(1));
    expect(inviteAdult).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "adult@example.test",
        personId,
      }),
      expect.anything()
    );
    expect(screen.queryByText("adult@example.test")).toBeNull();
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("confirms self departure before submitting the exact current link", async () => {
    const departAdult = vi.fn().mockResolvedValue({
      canRetry: false,
      executionGeneration: 1,
      lastAttemptAtEpochMs: null,
      operationId: "departure_00000000-0000-4000-8000-000000000201",
      personId,
      state: "prepared",
      version: 1,
    });
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create: vi.fn(),
      departAdult,
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    renderPanel(operations, "member-current");
    await userEvent.click(
      await screen.findByRole("button", { name: "Leave household" })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Confirm leave" })
    );
    await waitFor(() => expect(departAdult).toHaveBeenCalledTimes(1));
    expect(departAdult).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedLinkVersion: 1,
        memberId: "member-current",
        personId,
      }),
      expect.anything()
    );
  });

  it("replays only the exact retained invitation after refresh without candidate selection", async () => {
    const inviteAdult = vi
      .fn()
      .mockRejectedValueOnce(failure("people_unavailable"))
      .mockResolvedValue({
        association: "associated",
        invitationId: "invitation-a",
        person: {
          ...unlinkedRoster.people[0],
          associationState: "invitation_pending",
          associationVersion: 1,
        },
      });
    const associateInvitation = vi.fn();
    const create = vi.fn();
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      associateInvitation,
      bootstrapCreator: vi.fn(),
      create,
      inviteAdult,
      list: vi.fn().mockResolvedValue(unlinkedRoster),
      restore: vi.fn(),
    };
    const firstRender = renderPanel(operations);
    await userEvent.selectOptions(
      await screen.findByLabelText("Person"),
      personId
    );
    await userEvent.type(screen.getByLabelText("Email"), "adult@example.test");
    await userEvent.click(
      screen.getByRole("button", { name: "Send invitation" })
    );
    await waitFor(() => expect(inviteAdult).toHaveBeenCalledTimes(1));
    const exactPayload = inviteAdult.mock.calls[0]?.[0];
    expect(exactPayload).toBeDefined();

    expect(
      await screen.findByRole("heading", { name: "Finish invitation setup" })
    ).toBeInTheDocument();
    firstRender.unmount();
    renderPanel(operations);

    expect(
      await screen.findByRole("heading", { name: "Finish invitation setup" })
    ).toBeInTheDocument();
    expect(screen.getByText("Intended person: Cillian")).toBeInTheDocument();
    expect(
      screen.getByText(/cannot select another pending invitation/iu)
    ).toBeInTheDocument();
    expect(screen.queryByText("invitation-a")).toBeNull();
    expect(screen.queryByText("invitation-other")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /find pending invitations/iu })
    ).toBeNull();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add person" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Finish original invitation" })
    );

    await waitFor(() => expect(inviteAdult).toHaveBeenCalledTimes(2));
    expect(inviteAdult.mock.calls[0]?.[0]).toEqual(exactPayload);
    expect(inviteAdult.mock.calls[1]?.[0]).toEqual(exactPayload);
    expect(associateInvitation).not.toHaveBeenCalled();
    expect(screen.queryByText("adult@example.test")).toBeNull();
    expect(screen.queryByDisplayValue("adult@example.test")).toBeNull();
  });

  it("rediscovers the original departure after refresh and repairs the same operation", async () => {
    const departAdult = vi
      .fn()
      .mockRejectedValue(failure("people_unavailable"));
    const getDepartureByMutation = vi
      .fn()
      .mockResolvedValue(
        departureOperation("revocation_repair_required", 2, true)
      );
    const retryDeparture = vi
      .fn()
      .mockResolvedValueOnce(
        departureOperation("finalization_repair_required", 3, true)
      )
      .mockResolvedValueOnce(departureOperation("completed", 4));
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      create: vi.fn(),
      departAdult,
      getDepartureByMutation,
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
      retryDeparture,
    };
    const firstRender = renderPanel(operations, "member-current");

    await userEvent.click(
      await screen.findByRole("button", { name: "Leave household" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm leave" })
    );

    await waitFor(() => expect(departAdult).toHaveBeenCalledTimes(1));
    const exactPayload = departAdult.mock.calls[0]?.[0];
    expect(exactPayload).toBeDefined();
    expect(
      await screen.findByRole("heading", { name: "Recover departure status" })
    ).toBeInTheDocument();
    firstRender.unmount();
    renderPanel(operations, "member-current");

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Recover original departure",
      })
    );
    expect(
      await screen.findByText("Access revocation needs repair.")
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Repair departure" })
    );
    expect(
      await screen.findByText("Roster finalization needs repair.")
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Repair departure" })
    );
    expect(
      await screen.findByText("Household departure completed.")
    ).toBeInTheDocument();

    expect(departAdult).toHaveBeenCalledTimes(1);
    expect(getDepartureByMutation).toHaveBeenCalledWith(
      exactPayload?.mutationId
    );
    expect(retryDeparture).toHaveBeenNthCalledWith(
      1,
      departureOperationId,
      expect.objectContaining({
        expectedOperationVersion: 2,
        memberId: "member-current",
      })
    );
    expect(retryDeparture).toHaveBeenNthCalledWith(
      2,
      departureOperationId,
      expect.objectContaining({
        expectedOperationVersion: 3,
        memberId: "member-current",
      })
    );
  });

  it("rediscovers and cancels the exact prepared departure without a replacement", async () => {
    const departAdult = vi
      .fn()
      .mockRejectedValue(failure("people_unavailable"));
    const getDepartureByMutation = vi
      .fn()
      .mockResolvedValue(departureOperation("prepared", 1));
    const cancelDeparture = vi
      .fn()
      .mockRejectedValueOnce(failure("people_unavailable"))
      .mockResolvedValueOnce(departureOperation("cancelled", 2));
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator: vi.fn(),
      cancelDeparture,
      create: vi.fn(),
      departAdult,
      getDepartureByMutation,
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    const firstRender = renderPanel(operations, "member-current");

    await userEvent.click(
      await screen.findByRole("button", { name: "Leave household" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm leave" })
    );
    await waitFor(() => expect(departAdult).toHaveBeenCalledTimes(1));
    const exactPayload = departAdult.mock.calls[0]?.[0];
    expect(exactPayload).toBeDefined();
    firstRender.unmount();
    renderPanel(operations, "member-current");

    expect(screen.queryByLabelText("Departure operation code")).toBeNull();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Recover original departure",
      })
    );
    expect(
      await screen.findByText("Access revocation has not started.")
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Cancel departure" })
    );
    expect(
      await screen.findByText("Household departure cancelled.")
    ).toBeInTheDocument();

    expect(getDepartureByMutation).toHaveBeenCalledWith(
      exactPayload?.mutationId
    );
    expect(cancelDeparture).toHaveBeenCalledTimes(2);
    expect(cancelDeparture).toHaveBeenNthCalledWith(
      1,
      departureOperationId,
      expect.objectContaining({ expectedOperationVersion: 1 })
    );
    expect(cancelDeparture.mock.calls[1]).toEqual(
      cancelDeparture.mock.calls[0]
    );
    expect(departAdult).toHaveBeenCalledTimes(1);
  });

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

  it("does not start a lifecycle transition while create remains pending", async () => {
    const pendingCreate = deferred<typeof HouseholdPerson.Type>();
    const archive = vi.fn().mockResolvedValue(roster.people[0]);
    const create = vi.fn(() => pendingCreate.promise);
    const operations: HouseholdPeopleOperations = {
      archive,
      bootstrapCreator: vi.fn(),
      create,
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    renderPanel(operations);

    await userEvent.type(await screen.findByLabelText("Name"), "Aoife");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());

    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(archive).not.toHaveBeenCalled();
  });

  it("does not start create while a lifecycle transition remains pending", async () => {
    const pendingArchive = deferred<typeof HouseholdPerson.Type>();
    const archive = vi.fn(() => pendingArchive.promise);
    const create = vi.fn().mockResolvedValue(roster.people[0]);
    const operations: HouseholdPeopleOperations = {
      archive,
      bootstrapCreator: vi.fn(),
      create,
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    renderPanel(operations);

    await userEvent.type(await screen.findByLabelText("Name"), "Aoife");
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm archive" })
    );
    await waitFor(() => expect(archive).toHaveBeenCalledOnce());

    expect(screen.getByRole("button", { name: "Add person" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    expect(create).not.toHaveBeenCalled();
  });

  it("admits only one person action before pending state rerenders", async () => {
    const archive = vi.fn(
      () => new Promise<typeof HouseholdPerson.Type>(() => {})
    );
    const create = vi.fn(
      () => new Promise<typeof HouseholdPerson.Type>(() => {})
    );
    const operations: HouseholdPeopleOperations = {
      archive,
      bootstrapCreator: vi.fn(),
      create,
      list: vi.fn().mockResolvedValue(roster),
      restore: vi.fn(),
    };
    renderPanel(operations);

    await userEvent.type(await screen.findByLabelText("Name"), "Aoife");
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    fireEvent.click(screen.getByRole("button", { name: "Add person" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));

    await waitFor(() =>
      expect(create.mock.calls.length + archive.mock.calls.length).toBe(1)
    );
  });

  it("gates creator bootstrap and create while either intent remains pending", async () => {
    const pendingBootstrap = deferred<typeof HouseholdPerson.Type>();
    const bootstrapCreator = vi.fn(() => pendingBootstrap.promise);
    const create = vi.fn(
      () => new Promise<typeof HouseholdPerson.Type>(() => {})
    );
    const operations: HouseholdPeopleOperations = {
      archive: vi.fn(),
      bootstrapCreator,
      create,
      list: vi.fn().mockResolvedValue(emptyRoster),
      restore: vi.fn(),
    };
    renderPanel(operations);

    await userEvent.type(await screen.findByLabelText("Your name"), "Maeve");
    await userEvent.click(
      screen.getByRole("button", { name: "Set up my person" })
    );
    await waitFor(() => expect(bootstrapCreator).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Add person" })).toBeDisabled();

    pendingBootstrap.resolve(
      Schema.decodeUnknownSync(HouseholdPerson)(roster.people[0])
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add person" })).toBeEnabled()
    );
    await userEvent.type(screen.getByLabelText("Name"), "Aoife");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: "Set up my person" })
    ).toBeDisabled();
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
            associationState: "unlinked",
            associationVersion: null,
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

  it.each([
    {
      action: "archive" as const,
      button: "Archive",
      operationsRoster: roster,
      retry: "Retry adding this person",
    },
    {
      action: "restore" as const,
      button: "Restore",
      operationsRoster: archivedRoster,
      retry: "Retry adding this person",
    },
  ])(
    "keeps an ambiguous create as the sole intent until it resolves before $action",
    async ({ action, button, operationsRoster, retry }) => {
      const create = vi
        .fn()
        .mockRejectedValueOnce(failure("people_unavailable"))
        .mockRejectedValueOnce(failure("people_unavailable"))
        .mockResolvedValueOnce(operationsRoster.people[0]);
      const transition = vi.fn().mockResolvedValue(operationsRoster.people[0]);
      const operations: HouseholdPeopleOperations = {
        archive: action === "archive" ? transition : vi.fn(),
        bootstrapCreator: vi.fn(),
        create,
        list: vi.fn().mockResolvedValue(operationsRoster),
        restore: action === "restore" ? transition : vi.fn(),
      };
      renderPanel(operations);

      const name = await screen.findByLabelText("Name");
      await userEvent.type(name, "Aoife");
      await userEvent.click(screen.getByRole("button", { name: "Add person" }));
      await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
      const exactIntent = create.mock.calls[0]?.[0];

      expect(name).toBeDisabled();
      expect(screen.getByRole("button", { name: button })).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: /Discard add-person retry/u })
      ).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
      expect(screen.getByRole("button", { name: retry })).toBeInTheDocument();
      expect(create.mock.calls).toHaveLength(2);
      expect(transition).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: retry }));
      await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
      expect(create.mock.calls[2]?.[0]).toEqual(exactIntent);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: button })).toBeEnabled()
      );
      await userEvent.click(screen.getByRole("button", { name: button }));
      if (action === "archive") {
        await userEvent.click(
          screen.getByRole("button", { name: "Confirm archive" })
        );
      }
      await waitFor(() => expect(transition).toHaveBeenCalledOnce());
    }
  );

  it("keeps an ambiguous bootstrap as the sole intent until its exact retry resolves", async () => {
    const bootstrapCreator = vi
      .fn()
      .mockRejectedValueOnce(failure("people_unavailable"))
      .mockRejectedValueOnce(failure("people_unavailable"))
      .mockResolvedValueOnce(roster.people[0]);
    const create = vi.fn().mockResolvedValue(roster.people[0]);
    const archive = vi.fn();
    const operations: HouseholdPeopleOperations = {
      archive,
      bootstrapCreator,
      create,
      list: vi.fn().mockResolvedValue(unlinkedRosterBeforeCreatorBootstrap),
      restore: vi.fn(),
    };
    renderPanel(operations);

    await userEvent.type(await screen.findByLabelText("Your name"), "Maeve");
    await userEvent.click(
      screen.getByRole("button", { name: "Set up my person" })
    );
    await waitFor(() => expect(bootstrapCreator).toHaveBeenCalledTimes(2));
    const exactIntent = bootstrapCreator.mock.calls[0]?.[0];

    expect(screen.getByLabelText("Your name")).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Discard setup retry/u })
    ).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Retry setting up my person" })
    );
    await waitFor(() => expect(bootstrapCreator).toHaveBeenCalledTimes(3));
    expect(bootstrapCreator.mock.calls[2]?.[0]).toEqual(exactIntent);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add person" })).toBeEnabled()
    );
    await userEvent.type(screen.getByLabelText("Name"), "Aoife");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
  });

  it.each([
    {
      action: "archive" as const,
      button: "Archive",
      operationsRoster: unlinkedRosterBeforeCreatorBootstrap,
      retry: "Retry archiving Household dependant",
    },
    {
      action: "restore" as const,
      button: "Restore",
      operationsRoster: unlinkedArchivedRosterBeforeCreatorBootstrap,
      retry: "Retry restoring Household dependant",
    },
  ])(
    "keeps an ambiguous $action as the sole intent and blocks create and bootstrap",
    async ({ action, button, operationsRoster, retry }) => {
      const transition = vi
        .fn()
        .mockRejectedValueOnce(failure("people_unavailable"))
        .mockRejectedValueOnce(failure("people_unavailable"))
        .mockResolvedValueOnce(operationsRoster.people[0]);
      const create = vi.fn();
      const bootstrapCreator = vi.fn();
      const operations: HouseholdPeopleOperations = {
        archive: action === "archive" ? transition : vi.fn(),
        bootstrapCreator,
        create,
        list: vi.fn().mockResolvedValue(operationsRoster),
        restore: action === "restore" ? transition : vi.fn(),
      };
      renderPanel(operations);

      await userEvent.click(
        await screen.findByRole("button", { name: button })
      );
      if (action === "archive") {
        await userEvent.click(
          screen.getByRole("button", { name: "Confirm archive" })
        );
      }
      await waitFor(() => expect(transition).toHaveBeenCalledTimes(2));
      const [exactIntent] = transition.mock.calls;

      expect(screen.getByLabelText("Name")).toBeDisabled();
      expect(screen.getByLabelText("Your name")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Add person" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Set up my person" })
      ).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: /Discard .* retry/u })
      ).toBeNull();
      expect(create).not.toHaveBeenCalled();
      expect(bootstrapCreator).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: retry }));
      await waitFor(() => expect(transition).toHaveBeenCalledTimes(3));
      expect(transition.mock.calls[2]).toEqual(exactIntent);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Add person" })).toBeEnabled()
      );
    }
  );

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
