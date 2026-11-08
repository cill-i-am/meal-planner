import { Effect, Redacted, Schema, Semaphore } from "effect";
import { describe, expect, it } from "vitest";

import {
  profile,
  remainingResponses,
} from "../../../packages/sigen/src/__fixtures__/remaining.js";
import { makeControlsClient } from "../../../packages/sigen/src/controls-client.js";
import { ControlChange } from "../../../packages/sigen/src/controls.js";
import type { Command } from "../../../packages/sigen/src/controls.js";
import {
  ControlOperation,
  StationId,
  failure,
} from "../../../packages/sigen/src/model.js";
import { EnergyProfileFeatures } from "../../../packages/sigen/src/profile.js";
import { makeCommands } from "./commands.js";
import type { CommandBook } from "./commands.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const run = <A, E>(program: Effect.Effect<A, E>) => Effect.runPromise(program);
const create = Schema.decodeUnknownSync(ControlChange)({
  description: "Synthetic",
  name: "New profile",
  operation: "create_energy_profile",
  source: { kind: "template", profileId: 200, providerMode: 9 },
});
const edit = (profileId: number, name = "Updated") =>
  Schema.decodeUnknownSync(ControlChange)({
    edits: { name },
    operation: "update_energy_profile",
    profileId,
  });
const identity = (command: Command) => ({
  commandId: command.review.commandId,
  stationId: id,
});
const approve = (command: Command, mode: "once" | "always") => ({
  ...identity(command),
  change: command.review.change,
  current: command.review.current,
  mode,
  reviewFingerprint: command.review.reviewFingerprint,
});
const fixture = async () => {
  let book: CommandBook | null = null;
  let loseResponse = false;
  let currentMode = 1;
  let backupReserve = 20;
  let active: Record<string, unknown> = { ...profile, profileId: null };
  let touRows = [
    {
      currType: 1,
      dischargeType: 0,
      endTime: "04:00",
      startTime: "01:00",
      stationId: 12_345,
      whichDay: "1,2,3,4,5,6,7",
    },
  ];
  const custom = new Map<number, Record<string, unknown>>();
  const writes: string[] = [];
  const lock = await run(Semaphore.make(1));
  const client = makeControlsClient(
    (path) =>
      Effect.sync(() => {
        const url = new URL(path, "https://fixture.invalid");
        if (url.pathname === "/device/energy-profile/support/12345") {
          return {
            ...Object.fromEntries(
              Object.keys(EnergyProfileFeatures.fields).map((key) => [
                key,
                true,
              ])
            ),
            batteryPriorityItem: ["pv", "grid"],
            gridPriorityItem: ["pv", "battery"],
            isIndustry: false,
          };
        }
        if (
          url.pathname === "/device/energy-profile/support/upgradeEms/12345"
        ) {
          return false;
        }
        if (url.pathname.includes("/mode/current/")) {
          return { currentMode, currentProfileId: -1 };
        }
        if (url.pathname === "/device/energy-profile/mode/all/12345") {
          return {
            defaultWorkingModes: [{ label: "TOU", value: "2" }],
            energyProfileItems: [...custom].map(([profileId, entry]) => ({
              name: entry["name"],
              profileId,
            })),
          };
        }
        if (
          url.pathname.includes("/setting/info/") &&
          url.searchParams.get("mode") === "9" &&
          url.searchParams.get("profileId") !== "200"
        ) {
          return custom.get(Number(url.searchParams.get("profileId")));
        }
        if (url.pathname === "/device/energy-profile/setting/12345") {
          return active;
        }
        if (url.pathname === "/device/setting/backup/reserve/12345") {
          return {
            backupReserve,
            operationMode: currentMode,
            stationId: 12_345,
          };
        }
        if (url.pathname === "/device/setting/tou/12345") {
          return { currType: 1 };
        }
        if (url.pathname === "/device/dischargesetting/12345") {
          return touRows;
        }
        return remainingResponses[url.pathname];
      }),
    (method, path, body) =>
      Effect.gen(function* acceptProfileWrite() {
        writes.push(`${method} ${path}`);
        if (method === "DELETE") {
          custom.delete(Number(path.split("/").at(-1)));
        } else if (path === "/device/energy-profile/mode") {
          currentMode = 2;
        } else if (path === "/device/setting/backup/reserve") {
          backupReserve = yield* Schema.decodeUnknownEffect(Schema.Number)(
            body?.["backupReserve"]
          ).pipe(Effect.mapError(() => failure("SchemaMismatch")));
        } else if (body?.["profileId"] === null) {
          active = { ...active, ...body, pvPriority: profile.pvPriority };
        } else {
          const input = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              name: Schema.String,
              note: Schema.String,
              profileId: Schema.Number,
            })
          )(body).pipe(Effect.mapError(() => failure("SchemaMismatch")));
          const profileId = method === "POST" ? 201 : input.profileId;
          custom.set(profileId, {
            ...profile,
            ...body,
            profileId,
            pvPriority: profile.pvPriority,
          });
        }
        if (loseResponse) {
          return yield* failure("UpstreamUnavailable");
        }
      })
  );
  const make = (
    enabled = true,
    operations: readonly ControlOperation[] = ControlOperation.literals
  ) =>
    makeCommands(
      {
        read: Effect.sync(() => book),
        write: (value) =>
          Effect.sync(() => {
            book = structuredClone(value);
          }),
      },
      {
        run: (_stationId, operation) =>
          lock.withPermits(1)(
            operation(Redacted.make("fixture"), "fixture-enrollment")
          ),
      },
      client,
      enabled ? operations : []
    );
  const service = make();
  return {
    changeTouStart: (startTime: string) => {
      touRows = touRows.map((row) => ({ ...row, startTime }));
    },
    custom,
    loseResponse: () => {
      loseResponse = true;
    },
    make,
    prepare: (change: ControlChange) =>
      run(
        service.prepareCommand({
          change,
          commandId: crypto.randomUUID(),
          stationId: id,
        })
      ),
    service,
    setMode: (mode: number) => {
      currentMode = mode;
    },
    writes,
  };
};

describe("durable profile approval journeys", () => {
  it("persists one-time approval, reconciles a lost create response after restart and never sends twice", async () => {
    const f = await fixture();
    const prepared = await f.prepare(create);
    await run(f.service.approveCommand(approve(prepared, "once")));
    f.loseResponse();
    expect(
      await run(f.service.executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "outcome_unknown" } });
    expect(
      await run(f.make().executeCommand(identity(prepared)))
    ).toMatchObject({
      phase: {
        observed: {
          kind: "profile",
          settings: {
            selected: { profileName: "New profile", providerProfileId: 201 },
          },
        },
        status: "verified",
      },
    });
    expect(f.writes).toEqual(["POST /device/energy-profile/setting/new"]);
    const next = await f.prepare(edit(201));
    expect(
      await run(f.service.executeCommand(identity(next)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
  });
  it("uses always approval only for its profile and operation; revocation invalidates a queued command", async () => {
    const f = await fixture();
    f.custom.set(201, { ...profile, name: "One", profileId: 201 });
    f.custom.set(202, { ...profile, name: "Two", profileId: 202 });
    const first = await f.prepare(edit(201));
    await run(f.service.approveCommand(approve(first, "always")));
    expect(await run(f.service.executeCommand(identity(first)))).toMatchObject({
      phase: { status: "verified" },
    });
    const other = await f.prepare(edit(202, "Different"));
    expect(
      await run(f.service.executeCommand(identity(other)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    const remove = await f.prepare({
      operation: "delete_energy_profile",
      profileId: 201,
    });
    expect(
      await run(f.service.executeCommand(identity(remove)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    const next = await f.prepare(edit(201, "Updated again"));
    const grants = await run(f.service.approvalGrants(id));
    const [grant] = grants.grants;
    if (grant === undefined) {
      throw new Error("Missing grant");
    }
    await run(
      f.service.revokeApproval({ grantId: grant.grantId, stationId: id })
    );
    expect(
      await run(f.make().executeCommand(identity(next)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    expect(f.writes).toHaveLength(1);
  });
  it("rejects concurrent ancillary edits before dispatch and keeps the deployment kill switch effective", async () => {
    const f = await fixture();
    f.custom.set(201, { ...profile, name: "One", profileId: 201 });
    const command = await f.prepare(edit(201));
    await run(f.service.approveCommand(approve(command, "once")));
    f.custom.set(201, {
      ...profile,
      backupSOC: "60",
      name: "One",
      profileId: 201,
    });
    expect(
      await run(f.service.executeCommand(identity(command)))
    ).toMatchObject({ phase: { reason: "Conflict", status: "rejected" } });
    const disabled = await f.prepare(edit(201, "No dispatch"));
    await run(f.service.approveCommand(approve(disabled, "once")));
    expect(
      await run(
        f.make(false).executeCommand(identity(disabled)).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(f.writes).toHaveLength(0);
  });
});

describe("durable profile parameter approvals", () => {
  const parameterEdit = (profileId: number) =>
    Schema.decodeUnknownSync(ControlChange)({
      operation: "set_energy_profile_parameters",
      parameters: { solarLimit: { kind: "limited", watts: 4000 } },
      profileId,
    });
  it("keeps metadata grants separate, enforces the operation gate and persists parameter grants by profile", async () => {
    const f = await fixture();
    f.custom.set(201, { ...profile, name: "One", profileId: 201 });
    f.custom.set(202, { ...profile, name: "Two", profileId: 202 });
    const metadata = await f.prepare(edit(201));
    await run(f.service.approveCommand(approve(metadata, "always")));
    const parameters = await f.prepare(parameterEdit(201));
    expect(
      await run(
        f.service.executeCommand(identity(parameters)).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    await run(f.service.approveCommand(approve(parameters, "always")));
    expect(
      await run(
        f
          .make(true, ["update_energy_profile"])
          .executeCommand(identity(parameters))
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(f.writes).toHaveLength(0);
    expect(
      await run(f.make().executeCommand(identity(parameters)))
    ).toMatchObject({ phase: { status: "verified" } });
    expect(
      await run(f.make().executeCommand(identity(parameters)))
    ).toMatchObject({ phase: { status: "verified" } });
    expect(f.writes).toHaveLength(1);
    const other = await f.prepare(parameterEdit(202));
    expect(
      await run(f.make().executeCommand(identity(other)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    const next = await f.prepare(parameterEdit(201));
    const grants = await run(f.service.approvalGrants(id));
    const grant = grants.grants.find(
      (g) => g.scope.operation === "set_energy_profile_parameters"
    );
    if (!grant) {
      throw new Error("Missing parameter grant");
    }
    await run(
      f.service.revokeApproval({ grantId: grant.grantId, stationId: id })
    );
    expect(
      await run(f.make().executeCommand(identity(next)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
  });
  it("requires a fresh review after profile changes and does not replay ambiguous writes", async () => {
    const f = await fixture();
    f.custom.set(201, { ...profile, name: "One", profileId: 201 });
    const first = await f.prepare(parameterEdit(201));
    await run(f.service.approveCommand(approve(first, "once")));
    f.custom.set(201, {
      ...profile,
      name: "One",
      note: "Concurrent edit",
      profileId: 201,
    });
    expect(await run(f.service.executeCommand(identity(first)))).toMatchObject({
      phase: { reason: "Conflict", status: "rejected" },
    });
    expect(f.writes).toHaveLength(0);
    const fresh = await f.prepare(parameterEdit(201));
    await run(f.service.approveCommand(approve(fresh, "once")));
    f.loseResponse();
    expect(await run(f.service.executeCommand(identity(fresh)))).toMatchObject({
      phase: { status: "outcome_unknown" },
    });
    expect(await run(f.make().executeCommand(identity(fresh)))).toMatchObject({
      phase: { status: "verified" },
    });
    expect(f.writes).toHaveLength(1);
  });
});

describe("separate approval and dispatch gates for profile extras", () => {
  const priorityChange = Schema.decodeUnknownSync(ControlChange)({
    operation: "set_energy_profile_priorities",
    priorities: { batteryDischargeSources: ["grid", "pv"] },
    profileId: 201,
  });
  const scheduleChange = Schema.decodeUnknownSync(ControlChange)({
    operation: "set_energy_profile_schedules",
    profileId: 201,
    schedules: {
      preheating: {
        enabled: true,
        windows: [{ endTime: "01:15", providerDays: "1", startTime: "01:00" }],
      },
      timezone: "Europe/London",
    },
  });
  it.each([priorityChange, scheduleChange])(
    "requires its own approval, observes its dispatch gate and verifies a single write for $operation",
    async (change) => {
      const f = await fixture();
      f.custom.set(201, { ...profile, name: "One", profileId: 201 });
      const old = await f.prepare(edit(201));
      await run(f.service.approveCommand(approve(old, "always")));
      const prepared = await f.prepare(change);
      expect(
        await run(
          f.service.executeCommand(identity(prepared)).pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
      await run(f.service.approveCommand(approve(prepared, "once")));
      expect(
        await run(
          f
            .make(true, ["update_energy_profile"])
            .executeCommand(identity(prepared))
            .pipe(Effect.result)
        )
      ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
      expect(f.writes).toHaveLength(0);
      expect(
        await run(f.make().executeCommand(identity(prepared)))
      ).toMatchObject({ phase: { status: "verified" } });
      expect(
        await run(f.make().executeCommand(identity(prepared)))
      ).toMatchObject({ phase: { status: "verified" } });
      expect(f.writes).toHaveLength(1);
      const next = await f.prepare(change);
      expect(
        await run(f.service.executeCommand(identity(next)).pipe(Effect.result))
      ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    }
  );
});

const activeParameters = (backupSocPercent: number) =>
  Schema.decodeUnknownSync(ControlChange)({
    operation: "set_active_energy_profile_parameters",
    parameters: {
      batterySoc: {
        backupSocPercent,
        chargeSocPercent: 100,
        dischargeSocPercent: 20,
      },
    },
    target: { kind: "built_in", providerMode: 1 },
  });
const activateTou = Schema.decodeUnknownSync(ControlChange)({
  operation: "activate_time_of_use_mode",
});

describe("active energy setting approvals", () => {
  it("reuses a reserve grant for restoration and refuses another mode or operation", async () => {
    const f = await fixture();
    const first = await f.prepare(activeParameters(21));
    await run(f.service.approveCommand(approve(first, "always")));
    expect(await run(f.service.executeCommand(identity(first)))).toMatchObject({
      phase: { status: "verified" },
    });
    const sameTarget = await f.prepare(activeParameters(20));
    expect(
      await run(f.service.executeCommand(identity(sameTarget)))
    ).toMatchObject({ phase: { status: "verified" } });
    const activation = await f.prepare(activateTou);
    expect(
      await run(
        f.service.executeCommand(identity(activation)).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    f.setMode(0);
    await expect(f.prepare(activeParameters(21))).rejects.toMatchObject({
      reason: "UnsupportedCapability",
    });
    expect(f.writes).toEqual([
      "PUT /device/setting/backup/reserve",
      "PUT /device/setting/backup/reserve",
    ]);
  });

  it("blocks TOU activation after timetable drift and reconciles one lost acknowledgement", async () => {
    const f = await fixture();
    const outdated = await f.prepare(activateTou);
    await run(f.service.approveCommand(approve(outdated, "once")));
    f.changeTouStart("02:00");
    expect(
      await run(f.service.executeCommand(identity(outdated)))
    ).toMatchObject({ phase: { reason: "Conflict", status: "rejected" } });
    expect(f.writes).toHaveLength(0);
    const prepared = await f.prepare(activateTou);
    await run(f.service.approveCommand(approve(prepared, "once")));
    f.loseResponse();
    expect(
      await run(f.service.executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "outcome_unknown" } });
    expect(
      await run(f.make().executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "verified" } });
    expect(f.writes).toEqual(["PUT /device/energy-profile/mode"]);
  });
});
