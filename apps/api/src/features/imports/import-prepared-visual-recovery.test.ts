import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AcquisitionGeneration } from "./import-media.model.js";
import { ImportTraceContext } from "./import-observability.js";
import { resolvePreparedVisualRecovery } from "./import-prepared-visual-recovery.js";
import { runPreparedVisualRecoveryWorkflowBranch } from "./import-runtime-composition.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import type { StoredImport } from "./import.repository.js";
import { CompatibilityFingerprint } from "./import.repository.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "00000000-0000-4000-8000-000000000208"
);
const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(16);
const rootSpeechDispatchId = `speech:${importId}:${generation}`;
const secondVisualRecoveryDispatchId = `visual:${importId}:${generation}:recovery:2`;
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-07-29T09:00:00.000Z"
);
const canonicalSourceId =
  Schema.decodeUnknownSync(SourceCanonicalId)("opaque:208");
const trace = Schema.decodeUnknownSync(ImportTraceContext)({
  correlationId: "10000000-0000-4000-8000-000000000003",
});

const storedImport = (
  status: "extracting_visual" | "transcribed"
): StoredImport => ({
  acquisitionGeneration: generation,
  canonicalSourceId,
  compatibilityFingerprint: Schema.decodeUnknownSync(CompatibilityFingerprint)(
    "a".repeat(64)
  ),
  sourceKind: "tiktok",
  trace,
  view: {
    createdAt: timestamp,
    evidence: [
      {
        kind: "original_media",
        referenceId: "imports/opaque/original",
      },
      {
        kind: "acquisition_manifest",
        referenceId: "imports/opaque/manifest",
      },
      {
        kind: "speech_transcript",
        referenceId: "imports/opaque/transcript",
      },
    ],
    id: importId,
    source: { canonicalId: canonicalSourceId, kind: "tiktok" },
    status: { kind: status },
    updatedAt: timestamp,
  },
});

describe("prepared visual recovery", () => {
  it.each([rootSpeechDispatchId, `${rootSpeechDispatchId}:recovery:1`])(
    "admits the exact second visual recovery with settled speech owner %s",
    (speechDispatchId) => {
      expect(
        resolvePreparedVisualRecovery({
          importId,
          speechDispatchId,
          stored: storedImport("transcribed"),
          visualDispatchId: secondVisualRecoveryDispatchId,
        })
      ).toEqual({
        _tag: "PreparedVisualRecoveryReady",
        acquisitionGeneration: generation,
        speechDispatchId,
        visualDispatchId: secondVisualRecoveryDispatchId,
      });
    }
  );

  it.each([
    {
      name: "missing import",
      speechDispatchId: rootSpeechDispatchId,
      stored: null,
      visualDispatchId: secondVisualRecoveryDispatchId,
    },
    {
      name: "non-transcribed state",
      speechDispatchId: rootSpeechDispatchId,
      stored: storedImport("extracting_visual"),
      visualDispatchId: secondVisualRecoveryDispatchId,
    },
    {
      name: "unowned speech",
      speechDispatchId: `${rootSpeechDispatchId}:recovery:2`,
      stored: storedImport("transcribed"),
      visualDispatchId: secondVisualRecoveryDispatchId,
    },
    {
      name: "first visual recovery",
      speechDispatchId: rootSpeechDispatchId,
      stored: storedImport("transcribed"),
      visualDispatchId: `visual:${importId}:${generation}:recovery:1`,
    },
    {
      name: "third visual recovery",
      speechDispatchId: rootSpeechDispatchId,
      stored: storedImport("transcribed"),
      visualDispatchId: `visual:${importId}:${generation}:recovery:3`,
    },
  ])("rejects $name before provider dispatch", (candidate) => {
    expect(
      resolvePreparedVisualRecovery({
        importId,
        speechDispatchId: candidate.speechDispatchId,
        stored: candidate.stored,
        visualDispatchId: candidate.visualDispatchId,
      })
    ).toEqual({
      _tag: "PreparedVisualRecoveryRejected",
      code: "state_mismatch",
    });
  });

  it("runs the deployed recovery branch without replaying acquisition or transcription", async () => {
    let providerContinuations = 0;
    let dispatchLookups = 0;
    const outcome = await Effect.runPromise(
      runPreparedVisualRecoveryWorkflowBranch({
        completeVisualAndRecipe: (recovery) =>
          Effect.sync(() => {
            providerContinuations += 1;
            expect(recovery).toMatchObject({
              acquisitionGeneration: generation,
              speechDispatchId: rootSpeechDispatchId,
              visualDispatchId: secondVisualRecoveryDispatchId,
            });
            return null;
          }),
        findStored: Effect.succeed(Option.some(storedImport("transcribed"))),
        importId,
        resolveDispatchIds: () =>
          Effect.sync(() => {
            dispatchLookups += 1;
            return {
              speechDispatchId: rootSpeechDispatchId,
              visualDispatchId: secondVisualRecoveryDispatchId,
            };
          }),
      })
    );

    expect(outcome).toEqual({ _tag: "PreparedVisualRecoveryCompleted" });
    expect(dispatchLookups).toBe(1);
    expect(providerContinuations).toBe(1);
  });

  it.each([
    {
      name: "missing import",
      speechDispatchId: rootSpeechDispatchId,
      stored: Option.none<StoredImport>(),
      visualDispatchId: secondVisualRecoveryDispatchId,
    },
    {
      name: "wrong import state",
      speechDispatchId: rootSpeechDispatchId,
      stored: Option.some(storedImport("extracting_visual")),
      visualDispatchId: secondVisualRecoveryDispatchId,
    },
    {
      name: "incomplete evidence",
      speechDispatchId: rootSpeechDispatchId,
      stored: Option.some({
        ...storedImport("transcribed"),
        view: {
          ...storedImport("transcribed").view,
          evidence: storedImport("transcribed").view.evidence.slice(0, 2),
        },
      } as unknown as StoredImport),
      visualDispatchId: secondVisualRecoveryDispatchId,
    },
    {
      name: "unowned speech dispatch",
      speechDispatchId: `${rootSpeechDispatchId}:recovery:2`,
      stored: Option.some(storedImport("transcribed")),
      visualDispatchId: secondVisualRecoveryDispatchId,
    },
    {
      name: "wrong visual recovery",
      speechDispatchId: rootSpeechDispatchId,
      stored: Option.some(storedImport("transcribed")),
      visualDispatchId: `visual:${importId}:${generation}:recovery:1`,
    },
  ])(
    "stops $name at the deployed branch before provider continuation",
    async ({ speechDispatchId, stored, visualDispatchId }) => {
      let providerContinuations = 0;
      const outcome = await Effect.runPromise(
        runPreparedVisualRecoveryWorkflowBranch({
          completeVisualAndRecipe: () =>
            Effect.sync(() => {
              providerContinuations += 1;
              return null;
            }),
          findStored: Effect.succeed(stored),
          importId,
          resolveDispatchIds: () =>
            Effect.succeed({
              speechDispatchId,
              visualDispatchId,
            }),
        })
      );

      expect(outcome).toEqual({
        _tag: "PreparedVisualRecoveryRejected",
        code: "state_mismatch",
      });
      expect(providerContinuations).toBe(0);
    }
  );
});
