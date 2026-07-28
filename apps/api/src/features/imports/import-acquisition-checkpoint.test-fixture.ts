import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Option, Schema } from "effect";

import { historicalAcquisitionCheckpointFixture } from "./import-acquisition-checkpoint.historical-fixture.js";
import {
  AcquisitionCheckpointContinuation,
  decodeAcquisitionCheckpoint,
  verifyAcquisitionCheckpointContinuation,
} from "./import-acquisition-checkpoint.js";
import { ImportId } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";

interface AcquisitionReplayTestEnv {
  readonly ACQUISITION_REPLAY_STATE: {
    readonly get: (key: string) => Promise<string | null>;
    readonly put: (key: string, value: string) => Promise<void>;
  };
  readonly AcquisitionReplayWorkflow: {
    readonly create: (options: {
      readonly id: string;
      readonly params: {
        readonly checkpoint: "canonical" | "invalid";
        readonly importId: string;
      };
    }) => Promise<void>;
    readonly get: (id: string) => Promise<{
      readonly restart: (options: {
        readonly from: { readonly name: string; readonly type: "do" };
      }) => Promise<void>;
      readonly status: () => Promise<unknown>;
    }>;
    readonly unsafeStartIntrospection: () => Promise<string>;
    readonly unsafeStopIntrospection: (sessionId: string) => Promise<void>;
    readonly unsafeWaitForStatus: (
      id: string,
      status: "complete"
    ) => Promise<void>;
  };
  readonly MealPlannerDatabase: AnyD1Database;
}

const decodeImportId = Schema.decodeUnknownSync(ImportId);

const stateKey = (instanceId: string, name: string) => `${instanceId}:${name}`;

const increment = (
  env: AcquisitionReplayTestEnv,
  instanceId: string,
  name: string
) =>
  Effect.promise(async () => {
    const key = stateKey(instanceId, name);
    const value = Number((await env.ACQUISITION_REPLAY_STATE.get(key)) ?? "0");
    await env.ACQUISITION_REPLAY_STATE.put(key, String(value + 1));
  });

const workflowExport = {
  kind: "workflow" as const,
  make: (rawEnv: unknown) => {
    const env = rawEnv as AcquisitionReplayTestEnv;
    return Effect.succeed(
      (input: {
        readonly checkpoint: "canonical" | "invalid";
        readonly importId: string;
      }) =>
        Effect.gen(function* runAcquisitionReplayWorkflow() {
          const event = yield* WorkflowEvent;
          const importId = decodeImportId(input.importId);
          const historicalCheckpoint =
            historicalAcquisitionCheckpointFixture(importId);
          const rawCheckpoint = yield* task(
            "resolve-acquire-store-verify-v2",
            increment(env, event.instanceId, "acquisition-calls").pipe(
              Effect.as(
                input.checkpoint === "canonical"
                  ? historicalCheckpoint
                  : {
                      ...historicalCheckpoint,
                      evidence: {
                        ...historicalCheckpoint.evidence,
                        acquiredAt: "2026-07-28T10:00:00Z",
                      },
                    }
              )
            )
          );
          const checkpoint = decodeAcquisitionCheckpoint(rawCheckpoint);
          if (checkpoint._tag === "AcquisitionCheckpointRejected") {
            return checkpoint;
          }
          yield* increment(env, event.instanceId, "decode-accepted");
          yield* task(
            "record-acquisition-v2",
            increment(env, event.instanceId, "record-calls").pipe(
              Effect.as("Recorded" as const)
            )
          );
          const continuation = yield* task(
            "verify-acquisition-continuation-v1",
            makeD1ImportRepository(env.MealPlannerDatabase)
              .findById(importId)
              .pipe(
                Effect.map(
                  Option.match({
                    onNone: () => ({
                      _tag: "AcquisitionCheckpointRejected" as const,
                      code: "historical_acquisition_checkpoint_invalid" as const,
                    }),
                    onSome: (stored) =>
                      verifyAcquisitionCheckpointContinuation({
                        importId,
                        outcome: checkpoint.outcome,
                        stored,
                      }),
                  })
                ),
                Effect.map(
                  Schema.encodeSync(AcquisitionCheckpointContinuation)
                ),
                Effect.orDie
              )
          );
          if (continuation._tag === "AcquisitionCheckpointRejected") {
            return continuation;
          }
          yield* increment(env, event.instanceId, "ownership-accepted");
          yield* task(
            "reserve-stage-budget-v1",
            increment(env, event.instanceId, "budget-reservation-calls")
          );
          yield* task(
            "transcribe-video-v1",
            Effect.all([
              increment(env, event.instanceId, "provider-dispatch-calls"),
              increment(env, event.instanceId, "speech-calls"),
            ])
          );
          return { _tag: "SpeechReached" as const };
        })
    );
  },
};

const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      AcquisitionReplayWorkflow: workflowExport,
    }),
    shape: () => ({}),
  },
});

const AcquisitionReplayWorkflowBridge = makeWorkflowBridge(WorkflowEntrypoint, {
  entrypoint,
  stack: { name: "meal-planner", stage: "test" },
})("AcquisitionReplayWorkflow");

export class AcquisitionReplayWorkflow extends AcquisitionReplayWorkflowBridge {}

const readRequest = (request: Request) =>
  request.json() as Promise<
    | {
        readonly action: "read";
        readonly id: string;
      }
    | {
        readonly action: "restart-speech";
        readonly id: string;
      }
    | {
        readonly checkpoint: "canonical" | "invalid";
        readonly action: "run";
        readonly id: string;
        readonly importId: string;
      }
  >;

export default {
  fetch: async (request: Request, rawEnv: unknown) => {
    const env = rawEnv as AcquisitionReplayTestEnv;
    const command = await readRequest(request);
    const read = (name: string) =>
      env.ACQUISITION_REPLAY_STATE.get(stateKey(command.id, name));
    if (command.action === "read") {
      return Response.json({
        acquisitionCalls: Number((await read("acquisition-calls")) ?? "0"),
        budgetReservationCalls: Number(
          (await read("budget-reservation-calls")) ?? "0"
        ),
        decodeAccepted: Number((await read("decode-accepted")) ?? "0"),
        ownershipAccepted: Number((await read("ownership-accepted")) ?? "0"),
        providerDispatchCalls: Number(
          (await read("provider-dispatch-calls")) ?? "0"
        ),
        recordCalls: Number((await read("record-calls")) ?? "0"),
        speechCalls: Number((await read("speech-calls")) ?? "0"),
      });
    }

    const workflow = env.AcquisitionReplayWorkflow;
    const sessionId = await workflow.unsafeStartIntrospection();
    try {
      if (command.action === "run") {
        await workflow.create({
          id: command.id,
          params: {
            checkpoint: command.checkpoint,
            importId: command.importId,
          },
        });
      } else {
        const instance = await workflow.get(command.id);
        await instance.restart({
          from: { name: "transcribe-video-v1", type: "do" },
        });
      }
      await workflow.unsafeWaitForStatus(command.id, "complete");
      const instance = await workflow.get(command.id);
      return Response.json(await instance.status());
    } finally {
      await workflow.unsafeStopIntrospection(sessionId);
    }
  },
};
