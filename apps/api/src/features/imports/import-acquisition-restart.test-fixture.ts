import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import * as Cloudflare from "alchemy/Cloudflare";
import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
} from "alchemy/Cloudflare/Workflows";
import type { WorkflowInstanceRestartOptions } from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { Effect, Schema, Stream } from "effect";

import {
  HouseholdCommitAcquisitionEvidenceInput,
  HouseholdReadAcquisitionAttemptsResult,
  HouseholdReadEvidenceReferencesResult,
} from "../households/evidence/household-evidence.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { HouseholdOrganizationId } from "../households/household.contract.js";
import {
  HouseholdAdmitRecipeImportInput,
  HouseholdAdmitRecipeImportResult,
  HouseholdImportMutationId,
  HouseholdResolveRecipeImportSourceInput,
} from "../households/recipe-import/household-recipe-import.contract.js";
import { HouseholdMemberAdmission } from "../households/rpc/command-envelope.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { acquireStoreVerify } from "./import-media-acquirer.js";
import type {
  AcquisitionBucketLike,
  AcquisitionMediaSource,
  R2ObjectBodyLike,
  R2ObjectLike,
} from "./import-media-acquirer.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import { AcquisitionTaskOutcome } from "./import-media.model.js";
import { workerTestR2PutBody } from "./import-worker-test-environment.js";
import type {
  WorkerTestR2Bucket,
  WorkerTestR2Object,
  WorkerTestR2ObjectBody,
} from "./import-worker-test-environment.js";
import { ImportId, SourceCanonicalId } from "./import.contracts.js";
import { runHouseholdAcquisitionTask } from "./import.workflow.js";

interface TestKvNamespace {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string) => Promise<void>;
}

interface NativeWorkflowInstance {
  readonly restart: (options?: WorkflowInstanceRestartOptions) => Promise<void>;
  readonly status: () => Promise<{ readonly status: string }>;
}

interface NativeWorkflowBinding {
  readonly create: (input: {
    readonly id: string;
    readonly params: Schema.Json;
  }) => Promise<void>;
  readonly get: (id: string) => Promise<NativeWorkflowInstance>;
  readonly unsafeStartIntrospection: () => Promise<string>;
  readonly unsafeStopIntrospection: (sessionId: string) => Promise<void>;
}

interface TestEnvironment {
  readonly ACQUISITION_RESTART_STATE: TestKvNamespace;
  readonly AcquisitionRestartWorkflow: NativeWorkflowBinding;
  readonly HouseholdDomainWorker: object;
  readonly ImportEvidenceBucket: WorkerTestR2Bucket;
}

const WorkflowInput = Schema.Struct({
  canonicalId: SourceCanonicalId,
  executionGeneration: ImportIntentExecutionGeneration,
  importId: ImportId,
  intentId: RecipeImportIntentId,
  organizationId: HouseholdOrganizationId,
});

const Command = Schema.Struct({
  commandId: Schema.String,
  organizationId: HouseholdOrganizationId,
  videoId: Schema.String,
});

const mediaBytes = new TextEncoder().encode("native-acquisition-media");
const mediaSha256 =
  "830f7bd6c5ed012f5b6644ed2f26dce3a6608f2fc2cfc062981bc1fe204b7646";

const retryableR2Failure = (stage: "store" | "verify") =>
  new RetryableAcquisitionError({ reason: "container_rpc", stage });

const r2Object = (object: WorkerTestR2Object): R2ObjectLike => {
  let projected: R2ObjectLike = {
    checksums: object.checksums,
    size: object.size,
  };
  if (object.customMetadata !== undefined) {
    projected = { ...projected, customMetadata: object.customMetadata };
  }
  if (object.httpMetadata !== undefined) {
    projected = { ...projected, httpMetadata: object.httpMetadata };
  }
  return projected;
};

const r2ObjectBody = (object: WorkerTestR2ObjectBody): R2ObjectBodyLike => ({
  ...r2Object(object),
  arrayBuffer: () =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => object.arrayBuffer(),
    }),
  text: () =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => object.text(),
    }),
});

const acquisitionBucket = (raw: WorkerTestR2Bucket): AcquisitionBucketLike => ({
  get: (key) =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => raw.get(key),
    }).pipe(
      Effect.map((object) => (object === null ? null : r2ObjectBody(object)))
    ),
  head: (key) =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => raw.head(key),
    }).pipe(
      Effect.map((object) => (object === null ? null : r2Object(object)))
    ),
  put: (key, value, options) =>
    Effect.gen(function* putR2Object() {
      const body = yield* workerTestR2PutBody(value, options.contentLength);
      return yield* Effect.tryPromise({
        catch: () => retryableR2Failure("store"),
        try: () => raw.put(key, body, options),
      });
    }).pipe(
      Effect.map((object) => (object === null ? null : r2Object(object)))
    ),
});

const mediaObject = (
  canonicalId: SourceCanonicalId
): AcquisitionMediaSource => ({
  cleanup: () => Effect.void,
  prepare: () =>
    Effect.succeed({
      artifactId: "native-acquisition-artifact",
      audioStreams: [{ codec: "aac", index: 0 }],
      bytes: mediaBytes.byteLength,
      durationSeconds: 12,
      metadata: {
        canonicalId,
        canonicalUrl: `https://www.tiktok.com/@mealplanner/video/${canonicalId}`,
        caption: "Native restart tracer",
        creator: { displayName: null, handle: "mealplanner", id: null },
        observedAt: "2026-08-25T00:00:00.000Z",
        provenance: {
          canonicalUrl: "provider_observed",
          caption: "creator_provided",
          creator: {
            displayName: null,
            handle: "provider_observed",
            id: null,
          },
          publishedAt: null,
        },
        publishedAt: null,
      },
      sha256: mediaSha256,
      videoStreams: [{ codec: "h264", index: 0 }],
    }),
  readArtifact: () => Stream.succeed(mediaBytes),
});

const stateKey = (instanceId: string, name: string) => `${instanceId}:${name}`;

const increment = (
  environment: TestEnvironment,
  instanceId: string,
  name: string
) =>
  Effect.promise(async () => {
    const key = stateKey(instanceId, name);
    const value = Number(
      (await environment.ACQUISITION_RESTART_STATE.get(key)) ?? "0"
    );
    await environment.ACQUISITION_RESTART_STATE.put(key, String(value + 1));
    return value + 1;
  });

const acquisitionWorkflowExport = {
  kind: "workflow" as const,
  make: (environment: TestEnvironment) =>
    Effect.succeed((rawInput: Schema.Json) =>
      Effect.gen(function* runAcquisitionRestartTracer() {
        const input =
          yield* Schema.decodeUnknownEffect(WorkflowInput)(rawInput);
        const event = yield* WorkflowEvent;
        const household = Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
          environment.HouseholdDomainWorker
        );
        const admission = {
          actor: {
            _tag: "System" as const,
            purpose: "recipe_import_lifecycle_commit" as const,
          },
          organizationId: input.organizationId,
        };
        const encodedOutcome = yield* task(
          "resolve-acquire-store-verify-v2",
          runHouseholdAcquisitionTask({
            admission,
            attempt: (allocation) =>
              acquireStoreVerify(
                acquisitionBucket(environment.ImportEvidenceBucket),
                mediaObject(allocation.canonicalSourceId),
                {
                  canonicalId: allocation.canonicalSourceId,
                  generation: allocation.generation,
                  importId: input.importId,
                }
              ),
            bucket: acquisitionBucket(environment.ImportEvidenceBucket),
            canonicalId: input.canonicalId,
            executionGeneration: input.executionGeneration,
            householdDomain: household,
            importId: input.importId,
            intentId: input.intentId,
          }).pipe(
            Effect.map(Schema.encodeSync(AcquisitionTaskOutcome)),
            Effect.flatMap((resolved) =>
              Effect.gen(function* holdBeforeWorkflowCheckpoint() {
                yield* Effect.promise(() =>
                  environment.ACQUISITION_RESTART_STATE.put(
                    stateKey(event.instanceId, "outcome"),
                    JSON.stringify(resolved)
                  )
                );
                yield* increment(environment, event.instanceId, "resolutions");
                yield* Effect.sleep(250);
                return resolved;
              })
            ),
            Effect.orDie
          )
        );
        const outcome = yield* Schema.decodeUnknownEffect(
          AcquisitionTaskOutcome
        )(encodedOutcome);
        return yield* task(
          "record-acquisition-v2",
          Effect.gen(function* commitRestartTracerEvidence() {
            if (outcome._tag !== "VerifiedAcquisition") {
              return { outcome: "NotRecorded" as const };
            }
            const command = yield* Schema.encodeEffect(
              HouseholdCommitAcquisitionEvidenceInput
            )({
              acquisitionAttemptGeneration: outcome.generation,
              admission,
              expectedGeneration: input.executionGeneration,
              intentId: input.intentId,
              // The same committed R2 evidence always has the same mutation identity.
              mutationId: Schema.decodeUnknownSync(HouseholdImportMutationId)(
                outcome.evidence.manifestSha256
              ),
              result: {
                acquiredAt: outcome.evidence.acquiredAt,
                audioStreams: outcome.evidence.audioStreams,
                durationSeconds: outcome.evidence.durationSeconds,
                references: [
                  {
                    byteLength: outcome.evidence.bytes,
                    deleteAt: outcome.evidence.deleteAt,
                    key: outcome.evidence.mediaKey,
                    kind: "original_media",
                    sha256: outcome.evidence.sha256,
                  },
                  {
                    byteLength: outcome.evidence.manifestByteLength,
                    deleteAt: outcome.evidence.deleteAt,
                    key: outcome.evidence.manifestKey,
                    kind: "acquisition_manifest",
                    sha256: outcome.evidence.manifestSha256,
                  },
                ],
                videoStreams: outcome.evidence.videoStreams,
              },
            }).pipe(Effect.orDie);
            const committed = yield* household
              .commitAcquisitionEvidence(command)
              .pipe(Effect.orDie);
            const replayed = yield* household
              .commitAcquisitionEvidence(command)
              .pipe(Effect.orDie);
            return {
              outcome: committed.outcome,
              replayOutcome: replayed.outcome,
            };
          })
        );
      })
    ),
};

const AlchemyRuntimeContractKey = "shape";
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      AcquisitionRestartWorkflow: acquisitionWorkflowExport,
    }),
    [AlchemyRuntimeContractKey]: () => ({}),
  },
});

const AcquisitionRestartWorkflowBridge = makeWorkflowBridge(
  WorkflowEntrypoint,
  {
    entrypoint,
    stack: { name: "meal-planner", stage: "test" },
  }
)("AcquisitionRestartWorkflow");

export class AcquisitionRestartWorkflow extends AcquisitionRestartWorkflowBridge {}

const waitForResolutions = async (
  environment: TestEnvironment,
  instanceId: string,
  expected: number,
  remaining = 2000
): Promise<void> => {
  const actual = Number(
    (await environment.ACQUISITION_RESTART_STATE.get(
      stateKey(instanceId, "resolutions")
    )) ?? "0"
  );
  if (actual >= expected) {
    return;
  }
  if (remaining === 0) {
    const status = await environment.AcquisitionRestartWorkflow.get(
      instanceId
    ).then((instance) => instance.status());
    throw new Error(
      `Timed out waiting for acquisition resolution ${expected}: ${JSON.stringify(status)}`
    );
  }
  await Effect.runPromise(Effect.sleep(10));
  return waitForResolutions(environment, instanceId, expected, remaining - 1);
};

const waitForTerminal = async (
  instance: NativeWorkflowInstance,
  remaining = 2000
): Promise<{ readonly status: string }> => {
  const status = await instance.status();
  if (status.status === "complete" || status.status === "errored") {
    return status;
  }
  if (remaining === 0) {
    throw new Error(
      `Timed out waiting for Workflow: ${JSON.stringify(status)}`
    );
  }
  await Effect.runPromise(Effect.sleep(10));
  return waitForTerminal(instance, remaining - 1);
};

export default {
  fetch: async (request: Request, environment: TestEnvironment) => {
    const command = await Effect.runPromise(
      Effect.promise(() => request.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Command))
      )
    );
    const household = Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
      environment.HouseholdDomainWorker
    );
    const memberAdmission = Schema.decodeUnknownSync(HouseholdMemberAdmission)({
      actor: { _tag: "Member", actorId: "a".repeat(64) },
      organizationId: command.organizationId,
    });
    await Effect.runPromise(
      household.ensureHousehold({ admission: memberAdmission })
    );
    const admitted = await Effect.runPromise(
      household
        .admitRecipeImport(
          Schema.decodeUnknownSync(HouseholdAdmitRecipeImportInput)({
            admission: memberAdmission,
            idempotencyKey: `restart-${command.commandId}`,
            source: {
              kind: "tiktok",
              url: `https://www.tiktok.com/@mealplanner/video/${command.videoId}`,
            },
          })
        )
        .pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(HouseholdAdmitRecipeImportResult)
          )
        )
    );
    const systemAdmission = {
      actor: {
        _tag: "System" as const,
        purpose: "recipe_import_lifecycle_commit" as const,
      },
      organizationId: command.organizationId,
    };
    const canonicalId = Schema.decodeUnknownSync(SourceCanonicalId)(
      command.videoId
    );
    await Effect.runPromise(
      household.resolveRecipeImportSource(
        Schema.decodeUnknownSync(HouseholdResolveRecipeImportSourceInput)({
          admission: systemAdmission,
          canonicalSourceId: canonicalId,
          canonicalUrl: `https://www.tiktok.com/@mealplanner/video/${command.videoId}`,
          expectedGeneration: 1,
          intentId: admitted.intent.id,
          mutationId: "b".repeat(64),
          sourceKind: "video",
        })
      )
    );
    const instanceId = `acquisition-restart-${command.commandId}`;
    const sessionId =
      await environment.AcquisitionRestartWorkflow.unsafeStartIntrospection();
    try {
      await environment.AcquisitionRestartWorkflow.create({
        id: instanceId,
        params: Schema.encodeSync(WorkflowInput)({
          canonicalId,
          executionGeneration: Schema.decodeUnknownSync(
            ImportIntentExecutionGeneration
          )(1),
          importId: Schema.decodeUnknownSync(ImportId)(admitted.intent.id),
          intentId: admitted.intent.id,
          organizationId: command.organizationId,
        }),
      });
      const instance =
        await environment.AcquisitionRestartWorkflow.get(instanceId);
      for (let replay = 1; replay <= 3; replay += 1) {
        // eslint-disable-next-line no-await-in-loop -- Each restart must observe the preceding execution before rewinding the same Workflow step.
        await waitForResolutions(environment, instanceId, replay);
        // eslint-disable-next-line no-await-in-loop -- Native Workflow restarts are intentionally serialized against the resolution marker.
        await instance.restart({
          from: { name: "resolve-acquire-store-verify-v2", type: "do" },
        });
      }
      await waitForResolutions(environment, instanceId, 4);
      const status = await waitForTerminal(instance);
      const outcomeJson = await environment.ACQUISITION_RESTART_STATE.get(
        stateKey(instanceId, "outcome")
      );
      const references = await Effect.runPromise(
        household
          .readEvidenceReferences({
            admission: systemAdmission,
            expectedGeneration: 1,
            intentId: admitted.intent.id,
          })
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(HouseholdReadEvidenceReferencesResult)
            )
          )
      );
      const attempts = await Effect.runPromise(
        household
          .readAcquisitionAttempts({
            admission: systemAdmission,
            expectedGeneration: 1,
            intentId: admitted.intent.id,
          })
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(HouseholdReadAcquisitionAttemptsResult)
            )
          )
      );
      const objects = await environment.ImportEvidenceBucket.list({
        prefix: `imports/${admitted.intent.id}/acquisition/v1/`,
      });
      return Response.json({
        attempts,
        objects: objects.objects.map(({ key }) => key).toSorted(),
        outcome: outcomeJson === null ? null : JSON.parse(outcomeJson),
        references,
        status,
      });
    } finally {
      await environment.AcquisitionRestartWorkflow.unsafeStopIntrospection(
        sessionId
      );
    }
  },
};
