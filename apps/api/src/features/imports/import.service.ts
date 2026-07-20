import { Context, Effect, Option, Schema } from "effect";

import type {
  CreateImportRequest,
  CreateImportResponse,
  GetImportResponse,
  IdempotencyKey,
  ImportId,
  ImportStatus,
  ImportTimestamp,
  ImportView,
} from "./import.contracts.js";
import {
  idempotencyConflict,
  importNotFound,
  incompatibleDuplicate,
} from "./import.errors.js";
import type { CreateImportError, GetImportError } from "./import.errors.js";
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
import type { ImportWorkflowStarterShape } from "./import.workflow.js";
import type {
  CanonicalIdentityResolution,
  CanonicalSourceIdentityResolverShape,
  SourceAvailabilityValidatorShape,
} from "./source-resolver.js";

const CompatibilityFingerprintSource = "meal-planner-import:v1:no-options";

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

const statusForResolution = (
  resolution: CanonicalIdentityResolution,
  availabilityValidator: SourceAvailabilityValidatorShape
) =>
  resolution._tag === "UnsupportedIdentity"
    ? Effect.succeed<ImportStatus>({
        code: "unsupported_post_type",
        kind: "unsupported",
        recovery: "submit_supported_public_video",
      })
    : Effect.map(
        availabilityValidator.validate({
          identity: resolution.identity,
          videoUrl: resolution.videoUrl,
        }),
        (availability): ImportStatus =>
          availability._tag === "Available"
            ? { kind: "queued" }
            : {
                code: "private_or_unavailable",
                kind: "failed",
                recovery: "check_source_visibility",
              }
      );

export interface MakeImportServiceOptions {
  readonly availabilityValidator: SourceAvailabilityValidatorShape;
  readonly identityResolver: CanonicalSourceIdentityResolverShape;
  readonly newId: () => ImportId;
  readonly now: () => ImportTimestamp;
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
  repository,
  workflowStarter,
}: MakeImportServiceOptions): ImportServiceShape => ({
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
      const existingRequest = yield* repository.findRequest(idempotencyKeyHash);

      if (Option.isSome(existingRequest)) {
        if (existingRequest.value.sourceLocatorHash === sourceLocatorHash) {
          return {
            disposition: "idempotency_replay" as const,
            import: existingRequest.value.import.view,
          };
        }

        const resolution = yield* identityResolver.resolve(request.source);
        const requestFingerprint = yield* requestFingerprintFor(
          resolution.identity,
          compatibilityFingerprint
        );
        if (existingRequest.value.requestFingerprint !== requestFingerprint) {
          return yield* Effect.fail(idempotencyConflict());
        }
        return {
          disposition: "idempotency_replay" as const,
          import: existingRequest.value.import.view,
        };
      }

      const resolution = yield* identityResolver.resolve(request.source);
      const requestFingerprint = yield* requestFingerprintFor(
        resolution.identity,
        compatibilityFingerprint
      );
      const canonical = yield* repository.findByCanonicalIdentity(
        resolution.identity
      );

      let candidate: StoredImport;
      if (Option.isSome(canonical)) {
        if (
          canonical.value.compatibilityFingerprint !== compatibilityFingerprint
        ) {
          return yield* Effect.fail(incompatibleDuplicate());
        }
        candidate = canonical.value;
      } else {
        const status = yield* statusForResolution(
          resolution,
          availabilityValidator
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

      if (
        accepted.disposition === "created" &&
        accepted.import.view.status.kind === "queued"
      ) {
        yield* workflowStarter.start(accepted.import.view.id);
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
});

export class ImportService extends Context.Service<
  ImportService,
  ImportServiceShape
>()("meal-planner/ImportService") {}
