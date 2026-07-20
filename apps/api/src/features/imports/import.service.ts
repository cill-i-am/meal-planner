import { Clock, Context, Duration, Effect, Option, Schema } from "effect";

import { AcquisitionGeneration } from "./import-media.model.js";
import type {
  CreateImportRequest,
  CreateImportResponse,
  GetImportResponse,
  IdempotencyKey,
  ImportId,
  ImportStatus,
  ImportTimestamp,
  ImportView,
  PrivateOrUnavailableImportStatus,
  QueuedImportStatus,
  UnsupportedImportStatus,
} from "./import.contracts.js";
import {
  idempotencyConflict,
  importNotFound,
  incompatibleDuplicate,
  sourceIdentityUnavailable,
  sourceValidationUnavailable,
} from "./import.errors.js";
import type {
  CreateImportError,
  GetImportError,
  SourceValidationUnavailable,
} from "./import.errors.js";
import type {
  CompatibilityFingerprint,
  ImportRepositoryShape,
  StoredImport,
} from "./import.repository.js";
import {
  CompatibilityFingerprint as CompatibilityFingerprintSchema,
  IdempotencyKeyHash,
  RequestFingerprint,
  SourceLocatorHash,
} from "./import.repository.js";
import { ensureImportWorkflowStarted } from "./import.workflow.js";
import type { ImportWorkflowStarterShape } from "./import.workflow.js";
import type { SourceAvailabilityValidatorShape } from "./source-availability.js";
import type {
  CanonicalIdentityResolution,
  CanonicalSourceIdentityResolverShape,
} from "./source-identity.js";

const CompatibilityFingerprintSource = "meal-planner-import:v1:no-options";
const ProviderDeadlineMilliseconds = 5000;

const finiteProviderDeadline = (override: number | undefined) => {
  const duration = override ?? ProviderDeadlineMilliseconds;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Provider deadline must be a positive finite duration");
  }
  return duration;
};

const withRemainingProviderBudget = <A, E, R, E2>(
  effect: Effect.Effect<A, E, R>,
  deadlineAt: number,
  onTimeout: () => E2
): Effect.Effect<A, E | E2, R> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((currentTime) => {
      const remaining = deadlineAt - currentTime;
      if (remaining <= 0) {
        return Effect.fail(onTimeout());
      }
      return Effect.timeoutOrElse(effect, {
        duration: Duration.millis(remaining),
        orElse: () => Effect.fail(onTimeout()),
      });
    })
  );

const digestSha256 = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value)
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  });

const requestFingerprintFor = (
  identity: CanonicalIdentityResolution["identity"],
  compatibilityFingerprint: CompatibilityFingerprint
) =>
  Effect.map(
    digestSha256(
      `request:v1:${identity.kind}:${identity.canonicalId}:${compatibilityFingerprint}`
    ),
    Schema.decodeUnknownSync(RequestFingerprint)
  );

type InitialImportStatus =
  | typeof QueuedImportStatus.Type
  | typeof PrivateOrUnavailableImportStatus.Type
  | typeof UnsupportedImportStatus.Type;

const statusForResolution = (
  resolution: CanonicalIdentityResolution,
  availabilityValidator: SourceAvailabilityValidatorShape,
  deadlineAt: number
): Effect.Effect<InitialImportStatus, SourceValidationUnavailable> =>
  resolution._tag === "UnsupportedIdentity"
    ? Effect.succeed<InitialImportStatus>({
        code: "unsupported_post_type",
        kind: "unsupported",
        recovery: "submit_supported_public_video",
      })
    : Effect.map(
        withRemainingProviderBudget(
          availabilityValidator.validate({
            identity: resolution.identity,
            videoUrl: resolution.videoUrl,
          }),
          deadlineAt,
          sourceValidationUnavailable
        ),
        (availability): InitialImportStatus =>
          availability._tag === "Available"
            ? { kind: "queued" }
            : {
                code: "private_or_unavailable",
                kind: "failed",
                recovery: "check_source_visibility",
              }
      );

const isRecoverableStatus = (status: ImportStatus) =>
  status.kind === "queued" ||
  status.kind === "acquiring" ||
  (status.kind === "failed" &&
    status.code === "acquisition_temporarily_unavailable");

export interface MakeImportServiceOptions {
  readonly availabilityValidator: SourceAvailabilityValidatorShape;
  readonly identityResolver: CanonicalSourceIdentityResolverShape;
  readonly newId: () => ImportId;
  readonly now: () => ImportTimestamp;
  /** Finite test-only override for the code-owned five-second provider budget. */
  readonly providerDeadlineMilliseconds?: number;
  readonly repository: ImportRepositoryShape;
  readonly workflowStarter: ImportWorkflowStarterShape;
}

export interface ImportServiceShape {
  readonly create: (
    request: CreateImportRequest,
    idempotencyKey: IdempotencyKey
  ) => Effect.Effect<CreateImportResponse, CreateImportError>;
  readonly get: (
    id: ImportId
  ) => Effect.Effect<GetImportResponse, GetImportError>;
}

export const makeImportService = ({
  availabilityValidator,
  identityResolver,
  newId,
  now,
  providerDeadlineMilliseconds: providerDeadlineOverride,
  repository,
  workflowStarter,
}: MakeImportServiceOptions): ImportServiceShape => {
  const providerDeadlineMilliseconds = finiteProviderDeadline(
    providerDeadlineOverride
  );

  return {
    create: (request, idempotencyKey) =>
      Effect.gen(function* create() {
        const compatibilityFingerprint = yield* Effect.map(
          digestSha256(CompatibilityFingerprintSource),
          Schema.decodeUnknownSync(CompatibilityFingerprintSchema)
        );
        const idempotencyKeyHash = yield* Effect.map(
          digestSha256(`idempotency-key:v1:${idempotencyKey}`),
          Schema.decodeUnknownSync(IdempotencyKeyHash)
        );
        const sourceLocatorHash = yield* Effect.map(
          digestSha256(
            `source-locator:v1:${request.source.kind}:${request.source.url}`
          ),
          Schema.decodeUnknownSync(SourceLocatorHash)
        );
        const existingRequest =
          yield* repository.findRequest(idempotencyKeyHash);

        if (
          Option.isSome(existingRequest) &&
          existingRequest.value.sourceLocatorHash === sourceLocatorHash
        ) {
          if (isRecoverableStatus(existingRequest.value.import.view.status)) {
            yield* ensureImportWorkflowStarted(
              workflowStarter,
              existingRequest.value.import.view.id
            );
          }
          return {
            disposition: "idempotency_replay" as const,
            import: existingRequest.value.import.view,
          };
        }

        const deadlineAt =
          (yield* Clock.currentTimeMillis) + providerDeadlineMilliseconds;
        const resolution = yield* withRemainingProviderBudget(
          identityResolver.resolve(request.source),
          deadlineAt,
          sourceIdentityUnavailable
        );
        const requestFingerprint = yield* requestFingerprintFor(
          resolution.identity,
          compatibilityFingerprint
        );

        if (Option.isSome(existingRequest)) {
          if (existingRequest.value.requestFingerprint !== requestFingerprint) {
            return yield* Effect.fail(idempotencyConflict());
          }
          if (isRecoverableStatus(existingRequest.value.import.view.status)) {
            yield* ensureImportWorkflowStarted(
              workflowStarter,
              existingRequest.value.import.view.id
            );
          }
          return {
            disposition: "idempotency_replay" as const,
            import: existingRequest.value.import.view,
          };
        }

        const canonical = yield* repository.findByCanonicalIdentity(
          resolution.identity
        );

        let candidate: StoredImport;
        if (Option.isSome(canonical)) {
          if (
            canonical.value.compatibilityFingerprint !==
            compatibilityFingerprint
          ) {
            return yield* Effect.fail(incompatibleDuplicate());
          }
          candidate = canonical.value;
        } else {
          const status = yield* statusForResolution(
            resolution,
            availabilityValidator,
            deadlineAt
          );
          const timestamp = now();
          const view: ImportView = {
            createdAt: timestamp,
            evidence: [],
            id: newId(),
            source: resolution.identity,
            status,
            updatedAt: timestamp,
          };
          candidate = {
            acquisitionGeneration: Schema.decodeUnknownSync(
              AcquisitionGeneration
            )(0),
            canonicalSourceId: resolution.identity.canonicalId,
            compatibilityFingerprint,
            sourceKind: resolution.identity.kind,
            view,
          };
        }

        const accepted = yield* repository.acceptRequest({
          candidate,
          idempotencyKeyHash,
          requestFingerprint,
          sourceLocatorHash,
        });

        if (isRecoverableStatus(accepted.import.view.status)) {
          yield* ensureImportWorkflowStarted(
            workflowStarter,
            accepted.import.view.id
          );
        }

        return {
          disposition: accepted.disposition,
          import: accepted.import.view,
        };
      }),
    get: (id) =>
      Effect.flatMap(repository.findById(id), (stored) =>
        Option.match(stored, {
          onNone: () => Effect.fail(importNotFound(id)),
          onSome: (value) => Effect.succeed({ import: value.view }),
        })
      ),
  };
};

export class ImportService extends Context.Service<
  ImportService,
  ImportServiceShape
>()("meal-planner/ImportService") {}
