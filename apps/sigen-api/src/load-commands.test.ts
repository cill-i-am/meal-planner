import { Effect, Redacted, Schema, Semaphore } from "effect";
import { describe, expect, it } from "vitest";

import {
  expandedResponses,
  loadControl,
} from "../../../packages/sigen/src/__fixtures__/expanded.js";
import { smartLoad } from "../../../packages/sigen/src/__fixtures__/remaining.js";
import { makeControlsClient } from "../../../packages/sigen/src/controls-client.js";
import { ControlChange } from "../../../packages/sigen/src/controls.js";
import type { Command } from "../../../packages/sigen/src/controls.js";
import { LoadAutoSettings } from "../../../packages/sigen/src/load-settings.js";
import type { ControlOperation } from "../../../packages/sigen/src/model.js";
import { StationId, failure } from "../../../packages/sigen/src/model.js";
import { makeCommands } from "./commands.js";
import type { CommandBook } from "./commands.js";

const run = <A, E>(program: Effect.Effect<A, E>) => Effect.runPromise(program);
const id = Schema.decodeUnknownSync(StationId)("12345");
const mode = (value: "manual" | "automatic") =>
  Schema.decodeUnknownSync(ControlChange)({
    loadKey: "synthetic-load",
    loadPath: 1,
    mode: value,
    operation: "set_smart_load_mode",
  });
const schedule = (endTime: string) =>
  Schema.decodeUnknownSync(ControlChange)({
    loadKey: "synthetic-load",
    loadPath: 1,
    operation: "set_smart_load_schedule",
    schedule: {
      readyBy: [],
      solar: null,
      timed: [
        {
          consumption: { batteryBoost: false, mode: "system" },
          enabled: true,
          endTime,
          providerDays: "1,2",
          startTime: "01:00",
        },
      ],
      timezone: "Europe/London",
    },
  });
const ScheduleBody = Schema.Struct({
  pvExcessParams: LoadAutoSettings.fields.pvExcessParams,
  schedule: Schema.Struct({
    smartSavePointParamsList: LoadAutoSettings.fields.smartSavePointParamsList,
    touPointParamsList: LoadAutoSettings.fields.touPointParamsList,
  }),
});
const identity = (command: Command) => ({
  commandId: command.review.commandId,
  stationId: id,
});
const approval = (command: Command, grant: "once" | "always") => ({
  ...identity(command),
  change: command.review.change,
  current: command.review.current,
  mode: grant,
  reviewFingerprint: command.review.reviewFingerprint,
});
const fixture = async () => {
  let book: CommandBook | null = null;
  let writes = 0;
  let loseResponse = false;
  const data = { ...expandedResponses };
  const lock = await run(Semaphore.make(1));
  const client = makeControlsClient(
    (path) =>
      Effect.succeed(data[new URL(path, "https://fixture.invalid").pathname]),
    (_method, path, body) =>
      Effect.gen(function* fakeLoadDispatch() {
        writes += 1;
        if (path.endsWith("/auto/on-grid")) {
          const replacement = yield* Schema.decodeUnknownEffect(ScheduleBody)(
            body
          ).pipe(Effect.mapError(() => failure("SchemaMismatch")));
          data["/device/tp-device/smart-loads/control-mode"] = {
            ...loadControl,
            autoModeParams: {
              ...replacement.schedule,
              pvExcessParams: replacement.pvExcessParams,
            },
          };
        } else {
          const value = Number(
            new URL(path, "https://fixture.invalid").searchParams.get(
              "controlMode"
            )
          );
          data["/device/tp-device/smart-loads"] = {
            ...smartLoad,
            runMode: value,
          };
          data["/device/tp-device/smart-loads/control-mode"] = {
            ...loadControl,
            controlMode: value,
          };
        }
        if (loseResponse) {
          return yield* failure("UpstreamUnavailable");
        }
      })
  );
  const make = (
    operations: readonly ControlOperation[] = [
      "set_smart_load_mode",
      "set_smart_load_schedule",
    ]
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
            operation(Redacted.make("synthetic"), "fixture-enrollment")
          ),
      },
      client,
      operations
    );
  const service = make();
  return {
    data,
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
    writes: () => writes,
  };
};
describe("durable smart-load mode approvals", () => {
  it("keeps the operation disabled independently of approval and reconciles uncertainty without replay", async () => {
    const f = await fixture();
    const prepared = await f.prepare(mode("automatic"));
    await run(f.service.approveCommand(approval(prepared, "once")));
    expect(
      await run(
        f
          .make(["set_smart_load_switch"])
          .executeCommand(identity(prepared))
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(f.writes()).toBe(0);
    f.loseResponse();
    expect(
      await run(f.service.executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "outcome_unknown" } });
    expect(
      await run(f.make().executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "verified" } });
    expect(f.writes()).toBe(1);
    const next = await f.prepare(mode("manual"));
    expect(
      await run(f.service.executeCommand(identity(next)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
  });
  it("applies always approval to mode only, checks configuration drift, and honors revocation", async () => {
    const f = await fixture();
    const first = await f.prepare(mode("automatic"));
    await run(f.service.approveCommand(approval(first, "always")));
    expect(await run(f.service.executeCommand(identity(first)))).toMatchObject({
      phase: { status: "verified" },
    });
    const next = await f.prepare(mode("manual"));
    f.data["/device/tp-device/smart-loads"] = {
      ...smartLoad,
      manualSwitch: 1,
      runMode: 0,
    };
    f.data["/device/tp-device/smart-loads/control-mode"] = {
      ...loadControl,
      controlMode: 0,
      manualModeSwitch: 1,
    };
    expect(await run(f.service.executeCommand(identity(next)))).toMatchObject({
      phase: { reason: "Conflict", status: "rejected" },
    });
    expect(f.writes()).toBe(1);
    f.data["/device/tp-device/smart-loads/control-mode"] = {
      ...loadControl,
      controlMode: 0,
    };
    f.data["/device/tp-device/smart-loads"] = { ...smartLoad, runMode: 0 };
    const queued = await f.prepare(mode("manual"));
    const grants = await run(f.service.approvalGrants(id));
    const [grant] = grants.grants;
    expect(grant?.scope).toMatchObject({
      loadKey: "synthetic-load",
      loadPath: 1,
      operation: "set_smart_load_mode",
    });
    if (!grant) {
      throw new Error("Expected saved approval");
    }
    await run(
      f.service.revokeApproval({ grantId: grant.grantId, stationId: id })
    );
    expect(
      await run(f.service.executeCommand(identity(queued)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
  });
});

describe("durable smart-load schedule approvals", () => {
  it("honors one approval, keeps dispatch gated, and reconciles a lost acknowledgement without replay", async () => {
    const f = await fixture();
    const prepared = await f.prepare(schedule("02:00"));
    await run(f.service.approveCommand(approval(prepared, "once")));
    expect(
      await run(
        f
          .make(["set_smart_load_mode"])
          .executeCommand(identity(prepared))
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "UnsupportedCapability" } });
    expect(f.writes()).toBe(0);
    f.loseResponse();
    expect(
      await run(f.service.executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "outcome_unknown" } });
    expect(
      await run(f.make().executeCommand(identity(prepared)))
    ).toMatchObject({ phase: { status: "verified" } });
    expect(f.writes()).toBe(1);
    const next = await f.prepare(schedule("03:00"));
    expect(
      await run(f.service.executeCommand(identity(next)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
  });

  it("reuses only the same load's schedule grant and honors revocation", async () => {
    const f = await fixture();
    const first = await f.prepare(schedule("02:00"));
    await run(f.service.approveCommand(approval(first, "always")));
    const grants = await run(f.service.approvalGrants(id));
    const [grant] = grants.grants;
    expect(grant?.scope).toEqual({
      loadKey: "synthetic-load",
      loadPath: 1,
      operation: "set_smart_load_schedule",
      stationId: id,
    });
    const next = await f.prepare(schedule("03:00"));
    expect(await run(f.service.executeCommand(identity(next)))).toMatchObject({
      phase: { status: "verified" },
    });
    const differentOperation = await f.prepare(mode("automatic"));
    expect(
      await run(
        f.service
          .executeCommand(identity(differentOperation))
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    const queued = await f.prepare(schedule("04:00"));
    if (!grant) {
      throw new Error("Expected a schedule grant");
    }
    await run(
      f.service.revokeApproval({ grantId: grant.grantId, stationId: id })
    );
    expect(
      await run(f.service.executeCommand(identity(queued)).pipe(Effect.result))
    ).toMatchObject({ failure: { reason: "ApprovalRequired" } });
    expect(f.writes()).toBe(1);
  });
});
