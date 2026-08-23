import { Effect, Option, Schema } from "effect";

import type { HouseholdImportEvidenceCurrent } from "./import-evidence.repository.household.js";
import { AcquisitionTaskOutcome } from "./import-media.model.js";
import type { VerifiedAcquisitionEvidence } from "./import-media.model.js";
import type { ImportId, SourceCanonicalId } from "./import.contracts.js";

export const AcquisitionCheckpointRejected = Schema.Struct({
  _tag: Schema.Literal("AcquisitionCheckpointRejected"),
  code: Schema.Literal("acquisition_checkpoint_invalid"),
});
export type AcquisitionCheckpointRejected =
  typeof AcquisitionCheckpointRejected.Type;

export const AcquisitionCheckpointAccepted = Schema.Struct({
  _tag: Schema.Literal("Accepted"),
});
export type AcquisitionCheckpointAccepted =
  typeof AcquisitionCheckpointAccepted.Type;

export const AcquisitionCheckpointContinuation = Schema.Union([
  AcquisitionCheckpointAccepted,
  AcquisitionCheckpointRejected,
]);
export type AcquisitionCheckpointContinuation =
  typeof AcquisitionCheckpointContinuation.Type;

export type DecodedAcquisitionCheckpoint =
  | {
      readonly _tag: "Accepted";
      readonly outcome: AcquisitionTaskOutcome;
    }
  | AcquisitionCheckpointRejected;

const rejected = (): AcquisitionCheckpointRejected => ({
  _tag: "AcquisitionCheckpointRejected",
  code: "acquisition_checkpoint_invalid",
});

const normalizeDurableCheckpoint = (
  raw: Schema.Json
): Schema.Json | undefined => {
  try {
    return structuredClone(raw);
  } catch {
    return undefined;
  }
};

export const decodeAcquisitionCheckpoint = (
  raw: Schema.Json
): DecodedAcquisitionCheckpoint => {
  const decoded = Schema.decodeUnknownOption(AcquisitionTaskOutcome, {
    onExcessProperty: "error",
  })(normalizeDurableCheckpoint(raw));
  return Option.match(decoded, {
    onNone: rejected,
    onSome: (outcome) => ({ _tag: "Accepted", outcome }),
  });
};

const ownsHouseholdSpeechContinuation = (
  current: HouseholdImportEvidenceCurrent
) =>
  current.status.kind === "acquired" ||
  current.status.kind === "transcribing" ||
  (current.status.kind === "failed" &&
    current.status.code === "transcription_failed");

/** Reconstructs only from the compact household-native current result. */
export const recoverHouseholdVerifiedAcquisitionCheckpoint = <
  FindError,
  VerifyError,
>(input: {
  readonly current: Effect.Effect<
    Option.Option<HouseholdImportEvidenceCurrent>,
    FindError
  >;
  readonly expectedCanonicalId: SourceCanonicalId;
  readonly importId: ImportId;
  readonly readEvidence: (
    current: HouseholdImportEvidenceCurrent
  ) => Effect.Effect<VerifiedAcquisitionEvidence | null, VerifyError>;
}) =>
  input.current.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<null>(null),
        onSome: (current) => {
          if (!ownsHouseholdSpeechContinuation(current)) {
            return Effect.succeed<null>(null);
          }
          if (
            current.importId !== input.importId ||
            current.sourceKind !== "tiktok" ||
            current.canonicalSourceId !== input.expectedCanonicalId
          ) {
            return Effect.succeed(rejected());
          }
          return input.readEvidence(current).pipe(
            Effect.map((evidence) =>
              evidence === null
                ? rejected()
                : ({
                    _tag: "VerifiedAcquisition" as const,
                    evidence,
                    generation: current.acquisitionGeneration,
                  } satisfies AcquisitionTaskOutcome)
            )
          );
        },
      })
    )
  );

const verifyHouseholdAcquisitionCheckpointContinuation = (input: {
  readonly current: HouseholdImportEvidenceCurrent;
  readonly importId: ImportId;
  readonly outcome: AcquisitionTaskOutcome;
}): AcquisitionCheckpointContinuation => {
  if (input.outcome._tag !== "VerifiedAcquisition") {
    return { _tag: "Accepted" };
  }
  return input.current.importId === input.importId &&
    input.current.sourceKind === "tiktok" &&
    input.current.acquisitionGeneration === input.outcome.generation &&
    ownsHouseholdSpeechContinuation(input.current)
    ? { _tag: "Accepted" }
    : rejected();
};

/** Continues only after the household-native current result owns acquisition. */
export const continueHouseholdAcquisitionCheckpoint = <
  Value,
  FindError,
  AcceptedError,
  AcceptedRequirements,
>(input: {
  readonly current: Effect.Effect<
    Option.Option<HouseholdImportEvidenceCurrent>,
    FindError
  >;
  readonly importId: ImportId;
  readonly onAccepted: () => Effect.Effect<
    Value,
    AcceptedError,
    AcceptedRequirements
  >;
  readonly outcome: AcquisitionTaskOutcome;
}) =>
  input.current.pipe(
    Effect.flatMap(
      (
        currentOption
      ): Effect.Effect<
        Value | AcquisitionCheckpointRejected,
        AcceptedError,
        AcceptedRequirements
      > => {
        if (Option.isNone(currentOption)) {
          return Effect.succeed(rejected());
        }
        const continuation = verifyHouseholdAcquisitionCheckpointContinuation({
          current: currentOption.value,
          importId: input.importId,
          outcome: input.outcome,
        });
        return continuation._tag === "Accepted"
          ? input.onAccepted()
          : Effect.succeed(continuation);
      }
    )
  );
