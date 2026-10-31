import type { SigenFailure } from "@meal-planner/sigen";
import {
  ControlOperation,
  EnabledOperations,
  StationId,
  failure,
} from "@meal-planner/sigen";
import { ControlChange, ControlSnapshot } from "@meal-planner/sigen/controls";
import type { Command } from "@meal-planner/sigen/controls";
import { Effect, Redacted, Schema, Semaphore } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { makeCommands } from "./commands.js";
import type { CommandBook, CommandConnection } from "./commands.js";

const stationId = Schema.decodeUnknownSync(StationId)("12345");
const solar = (watts: number) =>
  Schema.decodeUnknownSync(ControlSnapshot)({
    kind: "solar",
    settings: {
      fetchedAt: Date.now(),
      powerLimit: { kind: "limited", watts },
      stationId,
    },
  });
const change = Schema.decodeUnknownSync(ControlChange)({
  limit: { kind: "limited", watts: 2000 },
  operation: "set_solar_power_limit",
});
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const approvedInput = (command: Command, mode: "once" | "always" = "once") => ({
  change: command.review.change,
  commandId: command.review.commandId,
  current: command.review.current,
  mode,
  reviewFingerprint: command.review.reviewFingerprint,
  stationId,
});
const identity = (command: Command) => ({
  commandId: command.review.commandId,
  stationId,
});
const fixture = async (enabled = true) => {
  let book: CommandBook | null = null;
  let snapshot = solar(3000);
  let currentConnection = "first-enrollment";
  const lock = await run(Semaphore.make(1));
  const connection: CommandConnection<never> = {
    run: (id, op) =>
      lock.withPermits(1)(
        id === stationId
          ? Effect.suspend(() =>
              op(Redacted.make("synthetic"), currentConnection)
            )
          : Effect.fail(failure("PermissionDenied"))
      ),
  };
  const dispatch = vi.fn((): Effect.Effect<void, SigenFailure> =>
    Effect.sync(() => {
      snapshot = solar(2000);
    })
  );
  const storage = {
    read: Effect.sync(() => book),
    write: (value: CommandBook) =>
      Effect.sync(() => {
        book = structuredClone(value);
      }),
  };
  const client = {
    dispatchControl: dispatch,
    inspectControl: () => Effect.sync(() => snapshot),
    validateControl: () => Effect.void,
  };
  const make = (
    operations: readonly ControlOperation[] = enabled
      ? ControlOperation.literals
      : []
  ) => makeCommands(storage, connection, client, operations);
  const service = make();
  return {
    book: () => book,
    client,
    dispatch,
    make,
    prepare: () =>
      run(
        service.prepareCommand({
          change,
          commandId: crypto.randomUUID(),
          stationId,
        })
      ),
    reconnect: () => {
      currentConnection = "second-enrollment";
    },
    service,
    setBook: (value: CommandBook) => {
      book = value;
    },
    setSnapshot: (watts: number) => {
      snapshot = solar(watts);
    },
  };
};

describe("durable physical commands", () => {
  it("requires explicit operation enablement even for an approved command and preserves existing receipts", async () => {
    const f = await fixture();
    const command = await f.prepare();
    await run(f.service.approveCommand(approvedInput(command, "once")));
    const restricted = f.make(["set_backup_reserve"]);
    expect(
      await run(
        restricted.executeCommand(identity(command)).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(
      await run(f.service.executeCommand(identity(command)))
    ).toMatchObject({ phase: { status: "verified" } });
    expect(
      await run(restricted.executeCommand(identity(command)))
    ).toMatchObject({ phase: { status: "verified" } });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it("validates operation configuration without enabling unknown or duplicate entries", () => {
    expectTypeOf<ControlOperation>().toEqualTypeOf<
      ControlChange["operation"]
    >();
    expect(Schema.is(EnabledOperations)([])).toBe(true);
    expect(Schema.is(EnabledOperations)(["set_backup_reserve"])).toBe(true);
    expect(
      Schema.is(EnabledOperations)(["set_backup_reserve", "set_backup_reserve"])
    ).toBe(false);
    expect(Schema.is(EnabledOperations)(["set_backup_reserv"])).toBe(false);
  });

  it("requires approval, binds its displayed values, survives reconstruction, and dispatches once under concurrency", async () => {
    const f = await fixture();
    const prepared = await f.prepare();
    expect(
      await run(
        f.service.executeCommand(identity(prepared)).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    expect(
      await run(
        f.service
          .approveCommand({
            ...approvedInput(prepared),
            change: {
              limit: { kind: "unlimited" },
              operation: "set_solar_power_limit",
            },
          })
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "Conflict" } });
    await run(f.service.approveCommand(approvedInput(prepared)));
    const restored = f.make();
    const results = await Promise.all([
      run(restored.executeCommand(identity(prepared))),
      run(restored.executeCommand(identity(prepared))),
    ]);
    expect(results.map((item) => item.phase.status)).toEqual([
      "verified",
      "verified",
    ]);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(
      await run(
        restored.approveCommand(approvedInput(prepared)).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "Conflict" } });
  });
  it("scopes smart-load always approval to both stable key and path and revokes queued permissions", async () => {
    const f = await fixture();
    const prepare = (loadKey: string, loadPath: number) =>
      run(
        f.service.prepareCommand({
          change: {
            enabled: true,
            loadKey,
            loadPath,
            operation: "set_smart_load_switch",
          },
          commandId: crypto.randomUUID(),
          stationId,
        })
      );
    const first = await prepare("load-a", 1);
    await run(f.service.approveCommand(approvedInput(first, "always")));
    const same = await prepare("load-a", 1);
    expect(same.phase.status).toBe("approved");
    const otherKey = await prepare("load-b", 1);
    expect(otherKey.phase.status).toBe("prepared");
    const otherPath = await prepare("load-a", 2);
    expect(otherPath.phase.status).toBe("prepared");
    const { grants } = await run(f.service.approvalGrants(stationId));
    const [grant] = grants;
    if (grant === undefined) {
      throw new Error("Expected grant");
    }
    expect(grant.scope).toEqual({
      loadKey: "load-a",
      loadPath: 1,
      operation: "set_smart_load_switch",
      stationId,
    });
    await run(f.service.revokeApproval({ grantId: grant.grantId, stationId }));
    expect(
      await run(f.service.executeCommand(identity(same)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("remembers only the chosen operation and station, revokes queued grant approvals, and clears grants across reenrollment", async () => {
    const f = await fixture();
    const first = await f.prepare();
    await run(f.service.approveCommand(approvedInput(first, "always")));
    const second = await f.prepare();
    expect(second.phase.status).toBe("approved");
    const different = await run(
      f.service.prepareCommand({
        change: { operation: "set_backup_reserve", reservePercent: 30 },
        commandId: crypto.randomUUID(),
        stationId,
      })
    );
    expect(different.phase.status).toBe("prepared");
    const grants = await run(f.service.approvalGrants(stationId));
    const [grant] = grants.grants;
    if (!grant) {
      throw new Error("Expected grant");
    }
    await run(f.service.revokeApproval({ grantId: grant.grantId, stationId }));
    expect(
      await run(f.service.executeCommand(identity(second)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    await run(f.service.approveCommand(approvedInput(first, "always")));
    f.reconnect();
    expect(await run(f.service.approvalGrants(stationId))).toEqual({
      grants: [],
    });
    expect(await run(f.service.getCommand(identity(first)))).toMatchObject({
      phase: { reason: "AuthenticationRequired", status: "rejected" },
    });
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("rejects expired and conflicting commands before submission, without treating changing fetch time as a conflict", async () => {
    const f = await fixture();
    const first = await f.prepare();
    await run(f.service.approveCommand(approvedInput(first)));
    f.setSnapshot(2500);
    expect(await run(f.service.executeCommand(identity(first)))).toMatchObject({
      phase: { reason: "Conflict", status: "rejected" },
    });
    const second = await f.prepare();
    await run(f.service.approveCommand(approvedInput(second)));
    const book = f.book();
    if (!book) {
      throw new Error("Expected book");
    }
    f.setBook({
      ...book,
      commands: book.commands.map((item) => ({
        ...item,
        review: { ...item.review, expiresAt: 0 },
      })),
    });
    expect(await run(f.service.executeCommand(identity(second)))).toMatchObject(
      { phase: { reason: "Conflict", status: "rejected" } }
    );
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("rechecks expiry after provider validation immediately before dispatch", async () => {
    const f = await fixture();
    const prepared = await f.prepare();
    await run(f.service.approveCommand(approvedInput(prepared)));
    f.client.validateControl = () =>
      TestClock.setTime(prepared.review.expiresAt + 1);
    await run(
      Effect.gen(function* expiresDuringValidation() {
        yield* TestClock.setTime(prepared.review.preparedAt);
        expect(
          yield* f.service.executeCommand(identity(prepared))
        ).toMatchObject({ phase: { reason: "Conflict", status: "rejected" } });
        expect(f.dispatch).not.toHaveBeenCalled();
      }).pipe(Effect.provide(TestClock.layer()))
    );
  });
  it("never retries a possibly submitted write and reconciles after a lost response", async () => {
    const f = await fixture();
    const prepared = await f.prepare();
    await run(f.service.approveCommand(approvedInput(prepared)));
    f.dispatch.mockImplementation(() =>
      Effect.fail(failure("UpstreamUnavailable"))
    );
    expect(
      await run(f.service.executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "outcome_unknown" } });
    expect(
      await run(f.make().executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "outcome_unknown" } });
    f.setSnapshot(2000);
    expect(
      await run(f.make().executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "verified" } });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it("retains ambiguous receipts and one-use IDs through reenrollment while discarding permissions", async () => {
    const f = await fixture();
    const prepared = await f.prepare();
    await run(f.service.approveCommand(approvedInput(prepared, "always")));
    f.dispatch.mockImplementation(() =>
      Effect.fail(failure("UpstreamUnavailable"))
    );
    await run(f.service.executeCommand(identity(prepared)));
    f.reconnect();
    expect(await run(f.service.approvalGrants(stationId))).toEqual({
      grants: [],
    });
    expect(await run(f.service.getCommand(identity(prepared)))).toMatchObject({
      phase: { status: "outcome_unknown" },
    });
    const another = await f.prepare();
    expect(another.phase.status).toBe("prepared");
    expect(
      await run(f.service.prepareCommand({ change, ...identity(prepared) }))
    ).toMatchObject({ phase: { status: "outcome_unknown" } });
    f.setSnapshot(2000);
    expect(
      await run(f.make().executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "verified" } });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it("preserves a dispatch marker through interruption and performs only reconciliation on restart", async () => {
    const f = await fixture();
    const prepared = await f.prepare();
    await run(f.service.approveCommand(approvedInput(prepared)));
    f.dispatch.mockImplementation(() => Effect.interrupt);
    await expect(
      run(f.service.executeCommand(identity(prepared)))
    ).rejects.toBeDefined();
    expect(f.book()?.commands[0]?.phase.status).toBe("dispatching");
    await run(f.make().executeCommand(identity(prepared)));
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it("returns the saved preparation for repeat IDs, rejects altered IDs, and respects the disable switch", async () => {
    const f = await fixture(false);
    const prepared = await f.prepare();
    expect(
      await run(f.service.prepareCommand({ change, ...identity(prepared) }))
    ).toEqual(prepared);
    expect(
      await run(
        f.service
          .prepareCommand({
            ...identity(prepared),
            change: { operation: "set_backup_reserve", reservePercent: 30 },
          })
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "Conflict" } });
    await run(f.service.approveCommand(approvedInput(prepared)));
    expect(
      await run(
        f.service.executeCommand(identity(prepared)).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(f.dispatch).not.toHaveBeenCalled();
  });
});
