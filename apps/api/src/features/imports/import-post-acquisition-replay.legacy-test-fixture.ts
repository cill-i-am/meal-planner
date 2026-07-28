import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { Effect, Schema } from "effect";

import { historicalAcquisitionCheckpointFixture } from "./import-acquisition-checkpoint.historical-fixture.js";
import { ImportId } from "./import.contracts.js";

interface PostAcquisitionReplayTestEnv {
  readonly PostAcquisitionReplayWorkflow: {
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
const canonicalIdFor = (importId: string) => {
  if (importId.endsWith("194")) {
    return "7520000000000000194";
  }
  if (importId.endsWith("195")) {
    return "7520000000000000195";
  }
  return "7520000000000000192";
};
const AcquisitionTaskStepConfig = {
  // eslint-disable-next-line sort-keys -- Production-faithful historical Workflow configuration.
  retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
  timeout: "17 minutes",
} as const;
const workflowExport = {
  kind: "workflow" as const,
  make: () =>
    Effect.succeed((input: { readonly importId: string }) =>
      Effect.gen(function* runLegacyPostAcquisitionReplay() {
        yield* WorkflowEvent;
        const importId = decodeImportId(input.importId);
        yield* task(
          "claim-acquisition-v1",
          Effect.succeed({
            _tag: "Acquiring" as const,
            canonicalId: canonicalIdFor(input.importId),
          })
        );
        const outcome = yield* task(
          "resolve-acquire-store-verify-v2",
          Effect.succeed(historicalAcquisitionCheckpointFixture(importId)),
          AcquisitionTaskStepConfig
        );
        if (
          !input.importId.endsWith("194") &&
          !input.importId.endsWith("195")
        ) {
          yield* task(
            "record-acquisition-v2",
            Effect.succeed("Recorded" as const)
          );
        }
        return yield* Effect.die(
          new Error(
            `historical post-acquisition interruption:${String(outcome._tag)}`
          )
        );
      })
    ),
};

const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      PostAcquisitionReplayWorkflow: workflowExport,
    }),
    shape: () => ({}),
  },
});

const PostAcquisitionReplayWorkflowBridge = makeWorkflowBridge(
  WorkflowEntrypoint,
  {
    entrypoint,
    stack: { name: "meal-planner", stage: "test" },
  }
)("PostAcquisitionReplayWorkflow");

export class PostAcquisitionReplayWorkflow extends PostAcquisitionReplayWorkflowBridge {}

export default {
  fetch: async (request: Request, rawEnv: unknown) => {
    const env = rawEnv as PostAcquisitionReplayTestEnv;
    const command = (await request.json()) as {
      readonly id: string;
      readonly importId: string;
    };
    const workflow = env.PostAcquisitionReplayWorkflow;
    const sessionId = await workflow.unsafeStartIntrospection();
    try {
      await workflow.unsafeSetIntrospectionOperations(sessionId, [
        {
          steps: [
            { name: "claim-acquisition-v1" },
            { name: "resolve-acquire-store-verify-v2" },
            { name: "record-acquisition-v2" },
          ],
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
