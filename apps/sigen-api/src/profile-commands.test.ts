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
  const custom = new Map<number, Record<string, unknown>>();
  const writes: string[] = [];
  const lock = await run(Semaphore.make(1));
  const client = makeControlsClient(
    (path) =>
      Effect.sync(() => {
        const url = new URL(path, "https://fixture.invalid");
        if (url.pathname.includes("/mode/current/")) {
          return { currentMode: 1, currentProfileId: -1 };
        }
        if (url.pathname === "/device/energy-profile/mode/all/12345") {
          return {
            defaultWorkingModes: [],
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
        return remainingResponses[url.pathname];
      }),
    (method, path, body) =>
      Effect.gen(function* acceptProfileWrite() {
        writes.push(`${method} ${path}`);
        if (method === "DELETE") {
          custom.delete(Number(path.split("/").at(-1)));
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
  const make = (enabled = true) =>
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
      enabled ? ControlOperation.literals : []
    );
  const service = make();
  return {
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
