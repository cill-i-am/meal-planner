import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Data, Effect, Schema } from "effect";

import {
  HouseholdEvidenceReferenceKind,
  HouseholdReadEvidenceReferencesResult,
} from "../households/evidence/household-evidence.contract.js";
import type { HouseholdObserveEvidenceReferenceInput } from "../households/evidence/household-evidence.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { HouseholdOrganizationId } from "../households/household.contract.js";
import { HouseholdImportMutationId } from "../households/recipe-import/household-recipe-import.contract.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

const ImportTimestampEncoded = Schema.toEncoded(ImportTimestamp);

const R2EvidenceEventAction = Schema.Literals([
  "CompleteMultipartUpload",
  "CopyObject",
  "DeleteObject",
  "LifecycleDeletion",
  "PutObject",
]);

/** Closed Cloudflare R2 event-notification body. */
export const R2EvidenceEvent = Schema.Struct({
  account: Schema.String,
  action: R2EvidenceEventAction,
  bucket: Schema.String,
  eventTime: ImportTimestampEncoded,
  object: Schema.Struct({
    eTag: Schema.optionalKey(Schema.String),
    key: Schema.String,
    size: Schema.optionalKey(Schema.Number),
  }),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type R2EvidenceEvent = typeof R2EvidenceEvent.Type;

export const RegisterImportEvidenceRoute = Schema.Struct({
  _tag: Schema.Literal("RegisterImportEvidenceRoute"),
  importId: ImportId,
  organizationId: HouseholdOrganizationId,
  routeVersion: Schema.Literal(1),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type RegisterImportEvidenceRoute =
  typeof RegisterImportEvidenceRoute.Type;

export const ImportEvidenceRoute = Schema.Struct({
  importId: ImportId,
  organizationId: HouseholdOrganizationId,
  routeVersion: Schema.Literal(1),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ImportEvidenceRoute = typeof ImportEvidenceRoute.Type;

const SafeImportEvidenceEvent = Schema.Struct({
  action: R2EvidenceEventAction,
  artifact: Schema.Literals([
    "acquisition_manifest",
    "carousel_image",
    "carousel_manifest",
    "original_media",
    "provider_audio",
    "provider_frame",
    "provider_manifest",
    "speech_transcript",
    "visual_manifest",
  ]),
  eventTime: ImportTimestampEncoded,
  executionGeneration: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1))
  ),
  importId: ImportId,
  objectKey: Schema.String,
  referenceKind: Schema.NullOr(HouseholdEvidenceReferenceKind),
});
export type SafeImportEvidenceEvent = typeof SafeImportEvidenceEvent.Type;

const importUuid =
  "([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";
const patterns = [
  {
    artifact: "original_media",
    pattern: new RegExp(
      `^imports/${importUuid}/acquisition/v1/generations/([1-9][0-9]*)/original\\.mp4$`,
      "iu"
    ),
    referenceKind: "original_media",
  },
  {
    artifact: "acquisition_manifest",
    pattern: new RegExp(
      `^imports/${importUuid}/acquisition/v1/generations/([1-9][0-9]*)/manifest\\.json$`,
      "iu"
    ),
    referenceKind: "acquisition_manifest",
  },
  {
    artifact: "speech_transcript",
    pattern: new RegExp(
      `^imports/${importUuid}/transcription/v1/generations/([1-9][0-9]*)/transcript\\.json$`,
      "iu"
    ),
    referenceKind: "speech_transcript",
  },
  {
    artifact: "visual_manifest",
    pattern: new RegExp(
      `^imports/${importUuid}/visual/v1/generations/([1-9][0-9]*)/manifest\\.json$`,
      "iu"
    ),
    referenceKind: "visual_manifest",
  },
  {
    artifact: "carousel_manifest",
    pattern: new RegExp(
      `^imports/${importUuid}/carousel/v1/generations/([1-9][0-9]*)/manifest\\.json$`,
      "iu"
    ),
    referenceKind: "carousel_manifest",
  },
  {
    artifact: "carousel_image",
    pattern: new RegExp(
      `^imports/${importUuid}/carousel/v1/generations/([1-9][0-9]*)/images/[0-9]{2}\\.jpg$`,
      "iu"
    ),
    referenceKind: null,
  },
  {
    artifact: "provider_manifest",
    pattern: new RegExp(
      `^imports/${importUuid}/generations/([1-9][0-9]*)/provider-evidence\\.json$`,
      "iu"
    ),
    referenceKind: null,
  },
  {
    artifact: "provider_audio",
    pattern: new RegExp(
      `^imports/${importUuid}/generations/([1-9][0-9]*)/provider-audio\\.wav$`,
      "iu"
    ),
    referenceKind: null,
  },
  {
    artifact: "provider_frame",
    pattern: new RegExp(
      `^imports/${importUuid}/generations/([1-9][0-9]*)/provider-frame-[0-9]+\\.jpg$`,
      "iu"
    ),
    referenceKind: null,
  },
] as const;

/** Decode the minimum internal routing identity without retaining account data. */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- closed Queue I/O boundary immediately Schema-decodes the untrusted body
export const decodeSafeImportEvidenceEvent = (untrusted: unknown) =>
  Schema.decodeUnknownEffect(R2EvidenceEvent, {
    onExcessProperty: "error",
  })(untrusted).pipe(
    Effect.flatMap((event) => {
      for (const candidate of patterns) {
        const match = candidate.pattern.exec(event.object.key);
        if (match?.[1] !== undefined && match[2] !== undefined) {
          return Schema.decodeUnknownEffect(SafeImportEvidenceEvent)({
            action: event.action,
            artifact: candidate.artifact,
            eventTime: event.eventTime,
            executionGeneration: Number(match[2]),
            importId: match[1],
            objectKey: event.object.key,
            referenceKind: candidate.referenceKind,
          });
        }
      }
      return Effect.fail(new Error("Unrecognized import evidence object key"));
    })
  );

export class ImportEvidenceEventFailure extends Data.TaggedError(
  "ImportEvidenceEventFailure"
)<{
  readonly reason:
    | "dependency_unavailable"
    | "integrity_mismatch"
    | "invalid_event"
    | "reference_unavailable"
    | "route_conflict"
    | "route_unavailable"
    | "stale_event";
  readonly retryable: boolean;
}> {}

export interface ImportEvidenceEventObject {
  readonly checksums?: { readonly sha256?: ArrayBuffer };
  readonly customMetadata?: Record<string, string>;
}

export interface ImportEvidenceEventPorts {
  readonly bucket: {
    readonly head: (
      key: string
    ) => Effect.Effect<
      ImportEvidenceEventObject | null,
      ImportEvidenceEventFailure
    >;
  };
  readonly household: {
    readonly observeEvidenceReference: (
      input: HouseholdObserveEvidenceReferenceInput
    ) => Effect.Effect<
      Effect.Success<
        ReturnType<HouseholdDomainWorkerMethods["observeEvidenceReference"]>
      >,
      ImportEvidenceEventFailure
    >;
    readonly readEvidenceReferences: (
      input: Parameters<
        HouseholdDomainWorkerMethods["readEvidenceReferences"]
      >[0]
    ) => Effect.Effect<
      Effect.Success<
        ReturnType<HouseholdDomainWorkerMethods["readEvidenceReferences"]>
      >,
      ImportEvidenceEventFailure
    >;
  };
  readonly routes: {
    readonly get: (
      importId: string
    ) => Effect.Effect<ImportEvidenceRoute | null, ImportEvidenceEventFailure>;
    readonly register: (
      route: ImportEvidenceRoute
    ) => Effect.Effect<
      "ConflictRejected" | "Registered",
      ImportEvidenceEventFailure
    >;
  };
}

export type ImportEvidenceEventOutcome =
  | { readonly _tag: "Ignored"; readonly reason: "untracked" | "stale" }
  | {
      readonly _tag: "Observed";
      readonly availability: "available" | "deleted" | "missing";
    }
  | { readonly _tag: "Registered" }
  | { readonly _tag: "RouteConflictRejected" };

const failure = (
  reason: ImportEvidenceEventFailure["reason"],
  retryable: boolean
) => new ImportEvidenceEventFailure({ reason, retryable });

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const digest = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ).pipe(
    Effect.map(bytesToHex),
    Effect.flatMap(Schema.decodeUnknownEffect(HouseholdImportMutationId)),
    Effect.mapError(() => failure("dependency_unavailable", true))
  );

const registerRoute = (
  message: RegisterImportEvidenceRoute,
  routes: ImportEvidenceEventPorts["routes"]
): Effect.Effect<ImportEvidenceEventOutcome, ImportEvidenceEventFailure> =>
  routes
    .register({
      importId: message.importId,
      organizationId: message.organizationId,
      routeVersion: message.routeVersion,
    })
    .pipe(
      Effect.map((outcome) =>
        outcome === "Registered"
          ? ({ _tag: "Registered" } as const)
          : ({ _tag: "RouteConflictRejected" } as const)
      )
    );

const route = (
  event: SafeImportEvidenceEvent,
  ports: ImportEvidenceEventPorts
): Effect.Effect<ImportEvidenceEventOutcome, ImportEvidenceEventFailure> =>
  Effect.gen(function* reconcileR2EvidenceEvent() {
    if (event.referenceKind === null) {
      return { _tag: "Ignored", reason: "untracked" } as const;
    }
    const resolved = yield* ports.routes.get(event.importId);
    if (resolved === null) {
      return yield* Effect.fail(failure("route_unavailable", true));
    }
    if (resolved.importId !== event.importId) {
      return yield* Effect.fail(failure("route_conflict", false));
    }
    const admission = {
      actor: {
        _tag: "System" as const,
        purpose: "recipe_import_lifecycle_commit" as const,
      },
      organizationId: resolved.organizationId,
    };
    const intentId = yield* Schema.decodeUnknownEffect(RecipeImportIntentId)(
      event.importId
    ).pipe(Effect.mapError(() => failure("invalid_event", false)));
    const eventTime = yield* Schema.decodeUnknownEffect(ImportTimestamp)(
      event.eventTime
    ).pipe(Effect.mapError(() => failure("invalid_event", false)));
    const encodedReferences = yield* ports.household.readEvidenceReferences({
      admission,
      expectedGeneration: event.executionGeneration,
      intentId,
    });
    const references = yield* Schema.decodeUnknownEffect(
      HouseholdReadEvidenceReferencesResult,
      { onExcessProperty: "error" }
    )(encodedReferences).pipe(
      Effect.mapError(() => failure("dependency_unavailable", true))
    );
    if (references === null) {
      return yield* Effect.fail(failure("reference_unavailable", true));
    }
    const reference = references.references.find(
      ({ key, kind }) => key === event.objectKey && kind === event.referenceKind
    );
    if (reference === undefined) {
      return { _tag: "Ignored", reason: "stale" } as const;
    }
    const deletion =
      event.action === "DeleteObject" || event.action === "LifecycleDeletion";
    let availability: "available" | "deleted" | "missing" = "deleted";
    if (!deletion) {
      const object = yield* ports.bucket.head(event.objectKey);
      if (object === null) {
        availability = "missing";
      } else {
        const nativeHash = object.checksums?.sha256;
        const metadata = object.customMetadata ?? {};
        if (
          nativeHash === undefined ||
          bytesToHex(nativeHash) !== reference.sha256 ||
          metadata["importId"] !== event.importId ||
          metadata["generation"] !== String(event.executionGeneration) ||
          metadata["sha256"] !== reference.sha256
        ) {
          return yield* Effect.fail(failure("integrity_mismatch", false));
        }
        availability = "available";
      }
    }
    const mutationId = yield* digest(
      JSON.stringify([
        "observe-r2-evidence-event",
        1,
        event.action,
        event.eventTime,
        event.objectKey,
        reference.sha256,
      ])
    );
    const observation = yield* ports.household.observeEvidenceReference({
      admission,
      availability,
      event: {
        action: event.action,
        eventTime,
      },
      expectedGeneration: event.executionGeneration,
      intentId,
      mutationId,
      reference: {
        key: reference.key,
        kind: reference.kind,
        sha256: reference.sha256,
      },
    });
    return observation.outcome === "IgnoredOlder"
      ? ({ _tag: "Ignored", reason: "stale" } as const)
      : ({ _tag: "Observed", availability: observation.availability } as const);
  });

/** Production reconciliation core shared by the Worker and Workerd proof. */
export const reconcileImportEvidenceQueueMessage = (
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- closed Queue I/O boundary dispatches to one of two Schema-decoded bodies
  untrusted: unknown,
  ports: ImportEvidenceEventPorts
): Effect.Effect<ImportEvidenceEventOutcome, ImportEvidenceEventFailure> => {
  if (Schema.is(RegisterImportEvidenceRoute)(untrusted)) {
    return registerRoute(untrusted, ports.routes);
  }
  return decodeSafeImportEvidenceEvent(untrusted).pipe(
    Effect.mapError(() => failure("invalid_event", false)),
    Effect.flatMap((event) => route(event, ports))
  );
};
