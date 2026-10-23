import { describe, expect, it } from "@effect/vitest";
import {
  emptyRecipeDetails,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import { Effect, Option } from "effect";

import { sha256Bytes } from "./import-digest.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import { EvidenceRetentionSeconds } from "./import-media.model.js";
import { produceRecipeDraftForImport } from "./import-recipe-draft.js";
import type {
  RecipeDraft,
  RecipeDraftRepository,
} from "./import-recipe-draft.repository.js";
import type {
  RecipeEvidenceAssembly,
  RecipeExtractor,
} from "./import-recipe-extractor.js";
import { groundRecipeCandidate } from "./import-recipe-grounding.js";
import type { SpeechTranscriber } from "./import-speech-transcriber.js";
import { transcribeAcquiredImport } from "./import-speech-transcription.js";
import type {
  CompletedTranscriptEvidence,
  SpeechTranscriptionRepository,
} from "./import-speech-transcription.repository.js";
import {
  transcriptEvidenceStatus,
  TranscriptEvidenceStore,
  TranscriptEvidenceStoreLive,
} from "./transcript-evidence-store.js";
import {
  acquiredFixture,
  cost,
  dispatchId,
  generation,
  importId,
  now,
  statuses,
  transcriptKey,
  unavailableSpeech,
} from "./transcript-evidence.test-fixture.js";
import {
  VisualEvidenceStore,
  VisualEvidenceStoreLive,
} from "./visual-evidence-store.js";

const pipelineFixture = (
  status: (typeof statuses)[number],
  audio: "available" | "absent" = "available"
) =>
  Effect.gen(function* makePipelineFixture() {
    const storage = yield* acquiredFixture(audio);
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    const audioSha256 = yield* sha256Bytes(audioBytes);
    const completed: CompletedTranscriptEvidence[] = [];
    const failures: string[] = [];
    const calls: string[] = [];
    const repository = (resume = false): SpeechTranscriptionRepository => ({
      claim: () =>
        Effect.succeed({
          _tag: resume ? "ResumeDispatch" : "DispatchClaimed",
          dispatchId,
          startedAt: now,
        }),
      complete: (evidence) =>
        Effect.sync(() => {
          completed.push(evidence);
          return evidence;
        }),
      fail: ({ failureCode }) =>
        Effect.sync(() => {
          failures.push(failureCode);
        }),
    });
    const speechTranscriber: SpeechTranscriber = {
      transcribe: () =>
        Effect.sync(() => {
          calls.push("provider");
          return unavailableSpeech(status);
        }),
    };
    const input = {
      acquisitionRepository: storage.current("acquired"),
      audioExtractor: {
        extract: () =>
          Effect.sync(() => {
            calls.push("audio");
            return {
              bytes: audioBytes,
              durationMilliseconds: 1000,
              mimeType: "audio/wav" as const,
              sha256: audioSha256,
            };
          }),
      },
      bucket: storage.bucket,
      importId,
      now: () => now,
      speechTranscriber,
      transcriptionRepository: repository(),
    };
    return { ...storage, calls, completed, failures, input, repository };
  });

const storeVisualEvidence = (
  fixture: Effect.Success<ReturnType<typeof pipelineFixture>>
) =>
  Effect.gen(function* writeVisualEvidence() {
    const bytes = new Uint8Array([255, 216, 255, 217]);
    const sha256 = yield* sha256Bytes(bytes);
    const store = yield* VisualEvidenceStore;
    yield* store.putVerified({
      frames: [
        {
          bytes,
          height: 1,
          mimeType: "image/jpeg",
          sha256,
          timestampMilliseconds: 0,
          width: 1,
        },
      ],
      manifest: {
        acquisitionGeneration: generation,
        cost,
        createdAt: now,
        dispatchId: `visual:${importId}:${generation}`,
        importId,
        model: "fixture-vision",
        observations: [],
        outcome: "empty",
        provider: "fixture",
        retention: {
          configuredAgeSeconds: EvidenceRetentionSeconds,
          policy: "r2_bucket_object_age",
        },
        schemaVersion: 1,
        sourceEvidenceDeleteAt: fixture.evidence.deleteAt,
        sourceMediaSha256: fixture.evidence.sha256,
        usage: { inputBytes: bytes.byteLength, inputFrames: 1, modelCalls: 1 },
      },
    });
  }).pipe(Effect.provide(VisualEvidenceStoreLive(fixture.bucket)));

const draftFixture = (
  fixture: Effect.Success<ReturnType<typeof pipelineFixture>>
) => {
  const assemblies: RecipeEvidenceAssembly[] = [];
  const drafts: RecipeDraft[] = [];
  const recipeRepository: RecipeDraftRepository = {
    claim: () => Effect.succeed({ _tag: "DispatchClaimed" }),
    complete: (draft) =>
      Effect.sync(() => {
        drafts.push(draft);
        return draft;
      }),
    fail: () => Effect.void,
  };
  const extractor: RecipeExtractor = {
    descriptor: { model: "fixture-recipe", provider: "fixture", version: "1" },
    extract: (assembly) =>
      Effect.sync(() => {
        assemblies.push(assembly);
        return {
          ...groundRecipeCandidate(
            {
              ...emptyRecipeDetails,
              ingredients: [recipeIngredientFromText("1 onion")],
              instructions: [recipeInstructionFromText("Chop the onion.", 1)],
              name: "Onion soup",
            },
            assembly.items
          ),
          cost,
          usage: {
            inputEvidenceItems: assembly.items.length,
            inputTokens: 0,
            latencyMilliseconds: 0,
            modelCalls: 1 as const,
            outputTokens: 0,
          },
        };
      }),
  };
  return {
    assemblies,
    drafts,
    run: () =>
      produceRecipeDraftForImport({
        bucket: fixture.bucket,
        extractor,
        importId,
        importRepository: fixture.current("visual_evidence_empty"),
        now: () => now,
        recipeRepository,
      }),
  };
};

describe("speech receipt pipeline and draft boundary", () => {
  it.effect(
    "creates a grounded draft from verified video-only evidence without calling speech",
    () =>
      Effect.gen(function* videoOnlySpeechReceipt() {
        const fixture = yield* pipelineFixture(statuses[0], "absent");
        yield* transcribeAcquiredImport({
          ...fixture.input,
          audioExtractor: {
            extract: () => Effect.succeed({ _tag: "NoAudioStream" as const }),
          },
        });
        expect(fixture.calls).toEqual([]);
        expect(fixture.completed[0]).toMatchObject({
          cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
          detectedLanguage: null,
          model: null,
          provider: null,
          segmentsCount: 0,
          transcript: { reason: "no_audio_stream", status: "absent" },
          usage: { audioDurationMilliseconds: 0, inputBytes: 0 },
        });
        const read = yield* TranscriptEvidenceStore.pipe(
          Effect.flatMap((store) =>
            store.readVerified({
              dispatchId,
              generation,
              importId,
              sourceMediaSha256: fixture.evidence.sha256,
            })
          ),
          Effect.provide(TranscriptEvidenceStoreLive(fixture.bucket))
        );
        expect(Option.getOrThrow(read).document).toMatchObject({
          reason: "no_audio_stream",
          schemaVersion: 2,
          status: "absent",
          text: null,
        });
        yield* storeVisualEvidence(fixture);
        const draft = draftFixture(fixture);
        yield* draft.run();
        expect(draft.drafts[0]?.transcript).toEqual({
          reason: "no_audio_stream",
          status: "absent",
        });
        expect(
          draft.assemblies[0]?.items.some((item) => item.kind === "transcript")
        ).toBe(false);
        expect(draft.drafts[0]?.lifecycle).toBe("needs_review");
      })
  );

  it.effect(
    "rejects a no-audio marker when verified acquisition contains an audio stream",
    () =>
      Effect.gen(function* contradictoryAudioAbsence() {
        const fixture = yield* pipelineFixture(statuses[0]);
        const result = yield* Effect.exit(
          transcribeAcquiredImport({
            ...fixture.input,
            audioExtractor: {
              extract: () => Effect.succeed({ _tag: "NoAudioStream" as const }),
            },
          })
        );
        expect(JSON.stringify(result)).toContain("source_evidence_invalid");
        expect(fixture.completed).toEqual([]);
        expect(fixture.calls).toEqual([]);
        expect(fixture.objects.has(transcriptKey)).toBe(false);
      })
  );

  it.effect(
    "rejects audio bytes when verified acquisition has no audio stream",
    () =>
      Effect.gen(function* contradictoryAudioBytes() {
        const fixture = yield* pipelineFixture(statuses[0], "absent");
        const result = yield* Effect.exit(
          transcribeAcquiredImport(fixture.input)
        );
        expect(JSON.stringify(result)).toContain("source_evidence_invalid");
        expect(fixture.completed).toEqual([]);
        expect(fixture.calls).toEqual(["audio"]);
        expect(fixture.objects.has(transcriptKey)).toBe(false);
      })
  );

  it.effect(
    "keeps audio extraction failure distinct from verified audio absence",
    () =>
      Effect.gen(function* missingAudioIsNotAbsence() {
        const fixture = yield* pipelineFixture(statuses[0]);
        const result = yield* Effect.exit(
          transcribeAcquiredImport({
            ...fixture.input,
            audioExtractor: {
              extract: () =>
                Effect.fail({
                  _tag: "SpeechAudioExtractionFailure" as const,
                  code: "audio_extraction_failed" as const,
                }),
            },
          })
        );
        expect(JSON.stringify(result)).toContain("audio_extraction_failed");
        expect(fixture.completed).toEqual([]);
        expect(fixture.calls).toEqual([]);
        expect(fixture.objects.has(transcriptKey)).toBe(false);
      })
  );

  for (const status of statuses) {
    it.effect(
      `persists ${status.status} speech and recovers its receipt without another provider call`,
      () =>
        Effect.gen(function* persistAndRecoverReceipt() {
          const fixture = yield* pipelineFixture(status);
          const first = yield* transcribeAcquiredImport(fixture.input);
          expect(first).toEqual({
            _tag: "Transcribed",
            generation,
            importId,
            transcriptKey,
          });
          expect(fixture.completed[0]).toMatchObject({
            cost,
            detectedLanguage: null,
            segmentsCount: 0,
            transcriptKey,
          });
          expect(fixture.failures).toEqual([]);
          const read = yield* TranscriptEvidenceStore.pipe(
            Effect.flatMap((store) =>
              store.readVerified({
                dispatchId,
                generation,
                importId,
                sourceMediaSha256: fixture.evidence.sha256,
              })
            ),
            Effect.provide(TranscriptEvidenceStoreLive(fixture.bucket))
          );
          expect(
            transcriptEvidenceStatus(Option.getOrThrow(read).document)
          ).toEqual(status);
          const replay = yield* transcribeAcquiredImport({
            ...fixture.input,
            transcriptionRepository: fixture.repository(true),
          });
          expect(replay).toEqual(first);
          expect(fixture.completed).toEqual([
            fixture.completed[0],
            fixture.completed[0],
          ]);
          expect(fixture.calls).toEqual(["audio", "provider"]);
        })
    );

    it.effect(
      `creates a caption-grounded review draft with explicit ${status.status} speech`,
      () =>
        Effect.gen(function* createCaptionGroundedDraft() {
          const fixture = yield* pipelineFixture(status);
          yield* transcribeAcquiredImport(fixture.input);
          yield* storeVisualEvidence(fixture);
          const draft = draftFixture(fixture);
          const result = yield* draft.run();
          expect(result.transcript).toEqual(status);
          expect(result.lifecycle).toBe("needs_review");
          expect(result.extraction.recipe.ingredients?.[0]?.original).toBe(
            "1 onion"
          );
          expect(draft.drafts).toEqual([result]);
          expect(
            draft.assemblies[0]?.items.some(
              (item) => item.kind === "transcript"
            )
          ).toBe(false);
          expect(draft.assemblies[0]?.items).toContainEqual(
            expect.objectContaining({
              kind: "caption",
              value: "Onion soup. 1 onion. Chop the onion.",
            })
          );
        })
    );
  }

  it.effect(
    "keeps unknown provider outcomes retryable and produces no absent receipt",
    () =>
      Effect.gen(function* keepUnknownProviderOutcome() {
        const fixture = yield* pipelineFixture(statuses[0]);
        const error = yield* Effect.flip(
          transcribeAcquiredImport({
            ...fixture.input,
            speechTranscriber: {
              transcribe: () =>
                Effect.fail({
                  _tag: "SpeechTranscriptionFailure",
                  code: "outcome_unknown",
                }),
            },
          })
        );
        expect(error).toMatchObject({
          _tag: "SpeechPipelineFailure",
          code: "outcome_unknown",
        });
        expect(fixture.objects.has(transcriptKey)).toBe(false);
        expect(fixture.completed).toEqual([]);
        expect(fixture.failures).toEqual([]);
      })
  );

  it.effect(
    "rejects a corrupted replay receipt without paying for another speech request",
    () =>
      Effect.gen(function* rejectCorruptedReplay() {
        const fixture = yield* pipelineFixture(statuses[0]);
        yield* transcribeAcquiredImport(fixture.input);
        fixture.update(transcriptKey, (object) => ({
          ...object,
          checksums: { sha256: new Uint8Array(32).buffer },
        }));
        const error = yield* Effect.flip(
          transcribeAcquiredImport({
            ...fixture.input,
            transcriptionRepository: fixture.repository(true),
          })
        );
        expect(error).toMatchObject({
          _tag: "SpeechPipelineFailure",
          code: "transcript_evidence_failed",
        });
        expect(fixture.calls).toEqual(["audio", "provider"]);
        expect(fixture.completed).toHaveLength(1);
      })
  );

  it.effect(
    "keeps a receipt write failure unknown rather than completing transcription",
    () =>
      Effect.gen(function* keepReceiptWriteUnknown() {
        const fixture = yield* pipelineFixture(statuses[0]);
        const bucket = {
          ...fixture.bucket,
          put: () =>
            Effect.fail(
              new RetryableAcquisitionError({
                reason: "container_rpc",
                stage: "store",
              })
            ),
        };
        const error = yield* Effect.flip(
          transcribeAcquiredImport({ ...fixture.input, bucket })
        );
        expect(error).toMatchObject({
          _tag: "SpeechPipelineFailure",
          code: "transcript_evidence_unknown",
        });
        expect(fixture.completed).toEqual([]);
        expect(fixture.failures).toEqual([]);
      })
  );

  it.effect(
    "rejects missing and corrupt speech artifacts before recipe extraction",
    () =>
      Effect.gen(function* rejectInvalidDraftEvidence() {
        for (const corruption of ["missing", "checksum"] as const) {
          const fixture = yield* pipelineFixture(statuses[0]);
          yield* transcribeAcquiredImport(fixture.input);
          yield* storeVisualEvidence(fixture);
          if (corruption === "missing") {
            fixture.objects.delete(transcriptKey);
          } else {
            fixture.update(transcriptKey, (object) => ({
              ...object,
              checksums: { sha256: new Uint8Array(32).buffer },
            }));
          }
          const draft = draftFixture(fixture);
          const error = yield* Effect.flip(draft.run());
          expect(error).toMatchObject({
            _tag: "RecipeDraftPipelineFailure",
            code: "source_evidence_invalid",
            reasonCode:
              corruption === "missing"
                ? "transcript_evidence_missing"
                : "transcript_native_checksum_mismatch",
          });
          expect(draft.assemblies).toEqual([]);
          expect(draft.drafts).toEqual([]);
        }
      })
  );
  it.effect(
    "re-verifies completed receipts and rejects missing, corrupt, or ledger-mismatched evidence",
    () =>
      Effect.gen(function* verifyCompletedReceipts() {
        for (const corruption of [
          "missing",
          "checksum",
          "ledger_hash",
        ] as const) {
          const fixture = yield* pipelineFixture(statuses[0]);
          const first = yield* transcribeAcquiredImport(fixture.input);
          const [evidence] = fixture.completed;
          if (evidence === undefined) {
            return yield* Effect.die("Missing completed evidence");
          }
          const completedRepository: SpeechTranscriptionRepository = {
            ...fixture.repository(),
            claim: () => Effect.succeed({ _tag: "Completed", evidence }),
          };
          expect(
            yield* transcribeAcquiredImport({
              ...fixture.input,
              transcriptionRepository: completedRepository,
            })
          ).toEqual(first);
          if (corruption === "missing") {
            fixture.objects.delete(transcriptKey);
          } else if (corruption === "checksum") {
            fixture.update(transcriptKey, (object) => ({
              ...object,
              checksums: { sha256: new Uint8Array(32).buffer },
            }));
          }
          const repository: SpeechTranscriptionRepository =
            corruption === "ledger_hash"
              ? {
                  ...completedRepository,
                  claim: () =>
                    Effect.succeed({
                      _tag: "Completed",
                      evidence: {
                        ...evidence,
                        transcriptSha256: "f".repeat(64),
                      },
                    }),
                }
              : completedRepository;
          const error = yield* Effect.flip(
            transcribeAcquiredImport({
              ...fixture.input,
              transcriptionRepository: repository,
            })
          );
          expect(error).toMatchObject({
            _tag: "SpeechPipelineFailure",
            code: "transcript_evidence_failed",
          });
          expect(fixture.calls).toEqual(["audio", "provider"]);
          expect(fixture.completed).toHaveLength(1);
        }
      })
  );
});
