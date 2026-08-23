import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { HouseholdOrganizationId } from "../households/household.contract.js";
import { HouseholdImportMutationId } from "../households/recipe-import/household-recipe-import.contract.js";
import {
  makeHouseholdSpeechTranscriptionRepository,
  makeHouseholdVisualEvidenceRepository,
} from "./import-evidence.repository.household.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";

describe("household evidence execution generation fencing", () => {
  it("keeps execution generation 1 when acquisition attempt 2 claims speech", async () => {
    const importId = Schema.decodeUnknownSync(ImportId)(
      "28de88d5-6034-42f1-8915-fd89ea656251"
    );
    const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(importId);
    const startedAt = Schema.decodeUnknownSync(ImportTimestamp)(
      "2026-08-23T15:00:00.000Z"
    );
    const expectedGenerations: number[] = [];
    const householdDomain = {
      mutateEvidenceStage: (command) => {
        expectedGenerations.push(command.expectedGeneration);
        return Effect.succeed({
          committedAt: "2026-08-23T15:00:00.000Z",
          executionGeneration: 1,
          intentId,
          outcome: "DispatchClaimed" as const,
          receiptVersion: 1 as const,
          stage: command.operation.stage,
        });
      },
      readEvidenceReferences: () => Effect.die("unused"),
      readEvidenceStage: (command) => {
        expectedGenerations.push(command.expectedGeneration);
        return Effect.succeed(null);
      },
      readRecipeImportExecution: () => Effect.die("unused"),
    } satisfies Pick<
      HouseholdDomainWorkerMethods,
      | "mutateEvidenceStage"
      | "readEvidenceReferences"
      | "readEvidenceStage"
      | "readRecipeImportExecution"
    >;
    const attemptGeneration = Schema.decodeUnknownSync(AcquisitionGeneration)(
      2
    );
    const repositoryInput = {
      acquisitionGeneration: attemptGeneration,
      canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
        "tiktok:video:attempt-two"
      ),
      correlationId: Schema.decodeUnknownSync(ImportCorrelationId)(
        "78ec195d-9428-42fb-b13d-e766399df9e8"
      ),
      executionGeneration: Schema.decodeUnknownSync(
        ImportIntentExecutionGeneration
      )(1),
      householdDomain,
      intentId,
      mutationId: () =>
        Effect.succeed(
          Schema.decodeUnknownSync(HouseholdImportMutationId)("a".repeat(64))
        ),
      organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
        "organization-generation-fence"
      ),
    };
    const repository =
      makeHouseholdSpeechTranscriptionRepository(repositoryInput);

    const claim = await Effect.runPromise(
      repository.claim({
        dispatchId: "speech-attempt-two",
        generation: attemptGeneration,
        importId,
        sourceMediaSha256: "b".repeat(64),
        startedAt,
      })
    );

    expect(claim._tag).toBe("DispatchClaimed");
    expect(expectedGenerations).toEqual([1, 1]);
  });

  it.each([
    {
      code: "transcript_evidence_failed" as const,
      makeRepository: makeHouseholdSpeechTranscriptionRepository,
      stage: "speech" as const,
    },
    {
      code: "frame_sampling_failed" as const,
      makeRepository: makeHouseholdVisualEvidenceRepository,
      stage: "visual" as const,
    },
  ])(
    "replays the exact committed $stage failure before issuing another Claim",
    async ({ code, makeRepository, stage }) => {
      const importId = Schema.decodeUnknownSync(ImportId)(
        "b74916e1-8e9e-4ed3-9f18-abf197dd7e43"
      );
      const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(importId);
      const acquisitionGeneration = Schema.decodeUnknownSync(
        AcquisitionGeneration
      )(2);
      const executionGeneration = Schema.decodeUnknownSync(
        ImportIntentExecutionGeneration
      )(1);
      const dispatchId = `${stage}:${importId}:2`;
      const sourceMediaSha256 = "c".repeat(64);
      const completedAt = "2026-08-23T15:01:00.000Z";
      const decodedCompletedAt =
        Schema.decodeUnknownSync(ImportTimestamp)(completedAt);
      let mutateCalls = 0;
      const householdDomain = {
        mutateEvidenceStage: () => {
          mutateCalls += 1;
          return Effect.die("failed replay must not mutate");
        },
        readEvidenceReferences: () => Effect.die("unused"),
        readEvidenceStage: () =>
          Effect.succeed({
            committedAt: "2026-08-23T16:00:00.000Z",
            completedAt,
            dispatchId,
            executionGeneration: 1,
            extractionContext: null,
            failureCode: code,
            inputFingerprint: sourceMediaSha256,
            intentId,
            outcome: "Failed",
            reference: null,
            result: null,
            stage,
            startedAt: "2026-08-23T15:00:00.000Z",
          } as never),
        readRecipeImportExecution: () => Effect.die("unused"),
      } satisfies Pick<
        HouseholdDomainWorkerMethods,
        | "mutateEvidenceStage"
        | "readEvidenceReferences"
        | "readEvidenceStage"
        | "readRecipeImportExecution"
      >;
      const repository = makeRepository({
        acquisitionGeneration,
        canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
          "tiktok:video:failed-replay"
        ),
        correlationId: Schema.decodeUnknownSync(ImportCorrelationId)(
          "24b5aa1d-477e-4607-93b5-50224cc12370"
        ),
        executionGeneration,
        householdDomain,
        intentId,
        mutationId: () =>
          Effect.succeed(
            Schema.decodeUnknownSync(HouseholdImportMutationId)("d".repeat(64))
          ),
        organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
          "organization-failed-replay"
        ),
      });

      const claim = await Effect.runPromise(
        repository.claim({
          dispatchId,
          generation: acquisitionGeneration,
          importId,
          sourceMediaSha256,
          startedAt: Schema.decodeUnknownSync(ImportTimestamp)(
            "2026-08-23T17:00:00.000Z"
          ),
        }) as unknown as Effect.Effect<unknown, never>
      );

      expect(claim).toEqual({
        _tag: "Failed",
        code,
        completedAt: decodedCompletedAt,
        dispatchId,
      });
      expect(mutateCalls).toBe(0);
    }
  );
});
