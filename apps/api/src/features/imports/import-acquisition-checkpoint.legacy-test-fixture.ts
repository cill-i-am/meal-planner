import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { Effect, Schema } from "effect";

import { historicalAcquisitionCheckpointFixture } from "./import-acquisition-checkpoint.historical-fixture.js";
import { decodeAcquisitionCheckpoint } from "./import-acquisition-checkpoint.js";
import { ProviderTaskStepConfig } from "./import-provider-workflow-task.js";
import { ImportId } from "./import.contracts.js";

interface AcquisitionReplayTestEnv {
  readonly ACQUISITION_REPLAY_STATE: {
    readonly get: (key: string) => Promise<string | null>;
    readonly put: (key: string, value: string) => Promise<void>;
  };
  readonly AcquisitionReplayWorkflow: {
    readonly create: (options: {
      readonly id: string;
      readonly params: { readonly importId: string };
    }) => Promise<void>;
    readonly get: (id: string) => Promise<{
      readonly status: () => Promise<unknown>;
    }>;
    readonly unsafeSetIntrospectionOperations: (
      sessionId: string,
      operations: readonly unknown[]
    ) => Promise<void>;
    readonly unsafeStartIntrospection: () => Promise<string>;
    readonly unsafeStopIntrospection: (sessionId: string) => Promise<void>;
    readonly unsafeWaitForStatus: (
      id: string,
      status: "errored"
    ) => Promise<void>;
  };
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
    return Effect.succeed((input: { readonly importId: string }) =>
      Effect.gen(function* runLegacyAcquisitionReplayWorkflow() {
        const event = yield* WorkflowEvent;
        const importId = decodeImportId(input.importId);
        const rawCheckpoint = yield* task(
          "resolve-acquire-store-verify-v2",
          increment(env, event.instanceId, "acquisition-calls").pipe(
            Effect.as(historicalAcquisitionCheckpointFixture(importId))
          )
        );
        const checkpoint = decodeAcquisitionCheckpoint(rawCheckpoint);
        if (checkpoint._tag === "AcquisitionCheckpointRejected") {
          return checkpoint;
        }
        yield* task(
          "record-acquisition-v2",
          increment(env, event.instanceId, "record-calls")
        );
        return yield* task(
          "transcribe-video-v1",
          increment(env, event.instanceId, "legacy-speech-attempts").pipe(
            Effect.andThen(
              Effect.die(
                new Error("historical transcription checkpoint failure")
              )
            )
          ),
          ProviderTaskStepConfig
        );
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

export default {
  fetch: async (request: Request, rawEnv: unknown) => {
    const env = rawEnv as AcquisitionReplayTestEnv;
    const command = (await request.json()) as {
      readonly action: "read" | "run";
      readonly id: string;
      readonly importId?: string;
    };
    if (command.action === "read") {
      const read = (name: string) =>
        env.ACQUISITION_REPLAY_STATE.get(stateKey(command.id, name));
      return Response.json({
        acquisitionCalls: Number((await read("acquisition-calls")) ?? "0"),
        legacySpeechAttempts: Number(
          (await read("legacy-speech-attempts")) ?? "0"
        ),
        recordCalls: Number((await read("record-calls")) ?? "0"),
      });
    }
    if (command.importId === undefined) {
      return new Response("Missing importId", { status: 400 });
    }
    const workflow = env.AcquisitionReplayWorkflow;
    const sessionId = await workflow.unsafeStartIntrospection();
    try {
      await workflow.unsafeSetIntrospectionOperations(sessionId, [
        {
          steps: [{ name: "transcribe-video-v1" }],
          type: "disableRetryDelays",
        },
      ]);
      await workflow.create({
        id: command.id,
        params: { importId: command.importId },
      });
      await workflow.unsafeWaitForStatus(command.id, "errored");
      const instance = await workflow.get(command.id);
      return Response.json(await instance.status());
    } finally {
      await workflow.unsafeStopIntrospection(sessionId);
    }
  },
};
