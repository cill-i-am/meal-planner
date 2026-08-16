import {
  Instant,
  RecipeImportIntentId,
  RecipeImportIntentVersion,
  RecipeImportRedirect,
  RedirectedRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import type {
  CancelRecipeImportIntentRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportRedirect as RecipeImportRedirectType,
  RedirectedRecipeImportIntent as RedirectedRecipeImportIntentType,
} from "@meal-planner/recipe-import-api";
import { Cause, Clock, Context, Effect, Layer, Option, Schema } from "effect";

import { ImportIntentWorkflowTerminator } from "./import-intent-execution.js";
import {
  ImportIntentTransitionCommandDigest,
  ImportIntentTransitionMutationId,
} from "./import-intent-transition.js";
import { deriveLegacyImportCorrelationId } from "./import-workflow-input.js";
import { ImportId } from "./import.contracts.js";
import type {
  ImportIntentRepositoryShape,
  ResolveImportIntentSourceCommand,
} from "./import.repository.js";
import {
  IdempotencyKeyHash,
  RequestFingerprint,
  SourceLocatorHash,
  StalledImportIntentStartLimit,
} from "./import.repository.js";
import type { ImportWorkflowReconcilerShape } from "./import.workflow.js";

const OpaqueSha256 = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const PositiveSafeInteger = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const NonNegativeSafeInteger = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);

export const StalledImportIntentStartMinimumAgeMilliseconds =
  PositiveSafeInteger.pipe(
    Schema.brand("StalledImportIntentStartMinimumAgeMilliseconds")
  );
export type StalledImportIntentStartMinimumAgeMilliseconds =
  typeof StalledImportIntentStartMinimumAgeMilliseconds.Type;

export const ReconcileStalledImportIntentStartsRequest = Schema.Struct({
  limit: StalledImportIntentStartLimit,
  minimumAgeMilliseconds: StalledImportIntentStartMinimumAgeMilliseconds,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ReconcileStalledImportIntentStartsRequest =
  typeof ReconcileStalledImportIntentStartsRequest.Type;

export const ReconcileStalledImportIntentStartsResult = Schema.Struct({
  ensured: NonNegativeSafeInteger,
  examined: NonNegativeSafeInteger,
  skipped: NonNegativeSafeInteger,
  startFailures: NonNegativeSafeInteger,
});
export type ReconcileStalledImportIntentStartsResult =
  typeof ReconcileStalledImportIntentStartsResult.Type;

export const HouseholdScopeId = OpaqueSha256.pipe(
  Schema.brand("HouseholdScopeId")
);
export type HouseholdScopeId = typeof HouseholdScopeId.Type;

export const ImportActorId = OpaqueSha256.pipe(Schema.brand("ImportActorId"));
export type ImportActorId = typeof ImportActorId.Type;

export const ImportPrincipal = Schema.Struct({
  actorId: ImportActorId,
  householdScopeId: HouseholdScopeId,
});
export type ImportPrincipal = typeof ImportPrincipal.Type;

export const LegacyPrivateHouseholdScopeId = Schema.decodeUnknownSync(
  HouseholdScopeId
)("1111111111111111111111111111111111111111111111111111111111111111");
export const LegacyPrivateImportActorId = Schema.decodeUnknownSync(
  ImportActorId
)("0000000000000000000000000000000000000000000000000000000000000000");
export const LegacyPrivateImportPrincipal = Schema.decodeUnknownSync(
  ImportPrincipal
)({
  actorId: LegacyPrivateImportActorId,
  householdScopeId: LegacyPrivateHouseholdScopeId,
});

export interface RecipeImportIntentIdempotencyConflict {
  readonly _tag: "RecipeImportIntentIdempotencyConflict";
}
export const RecipeImportIntentIdempotencyConflict =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeImportIntentIdempotencyConflict>()(
    "RecipeImportIntentIdempotencyConflict",
    {}
  );

export interface RecipeImportIntentNotFound {
  readonly _tag: "RecipeImportIntentNotFound";
}
export const RecipeImportIntentNotFound =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeImportIntentNotFound>()(
    "RecipeImportIntentNotFound",
    {}
  );

export interface RecipeImportIntentTransitionRejected {
  readonly _tag: "RecipeImportIntentTransitionRejected";
}
export const RecipeImportIntentTransitionRejected =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeImportIntentTransitionRejected>()(
    "RecipeImportIntentTransitionRejected",
    {}
  );

export interface RecipeImportIntentVersionConflict {
  readonly _tag: "RecipeImportIntentVersionConflict";
}
export const RecipeImportIntentVersionConflict =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeImportIntentVersionConflict>()(
    "RecipeImportIntentVersionConflict",
    {}
  );

export interface RecipeImportIntentRedirected {
  readonly _tag: "RecipeImportIntentRedirected";
  readonly intent: RedirectedRecipeImportIntentType;
  readonly redirect: RecipeImportRedirectType;
}
export const RecipeImportIntentRedirected =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeImportIntentRedirected>()(
    "RecipeImportIntentRedirected",
    {
      intent: RedirectedRecipeImportIntent,
      redirect: RecipeImportRedirect,
    }
  );

export class ImportIntentIdGenerator extends Context.Service<
  ImportIntentIdGenerator,
  { readonly next: Effect.Effect<RecipeImportIntentId> }
>()("meal-planner/ImportIntentIdGenerator") {
  static readonly live = Layer.succeed(
    ImportIntentIdGenerator,
    ImportIntentIdGenerator.of({
      next: Effect.sync(() =>
        Schema.decodeUnknownSync(RecipeImportIntentId)(crypto.randomUUID())
      ),
    })
  );
}

export const CancelImportIntentCommand = Schema.Struct({
  cancelledAt: Instant,
  commandDigest: ImportIntentTransitionCommandDigest,
  expectedIntentVersion: RecipeImportIntentVersion,
  intentId: RecipeImportIntentId,
  mutationId: ImportIntentTransitionMutationId,
  principal: ImportPrincipal,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type CancelImportIntentCommand = typeof CancelImportIntentCommand.Type;

const sha256Hex = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value)
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  });

const currentInstant = Clock.currentTimeMillis.pipe(
  Effect.map((millis) =>
    Schema.decodeUnknownSync(Instant)(new Date(millis).toISOString())
  )
);

const requestFingerprint = (request: CreateRecipeImportIntentRequest) =>
  Effect.map(
    sha256Hex(
      `recipe-import-intent-request:v1:${request.source.kind}:${request.source.url}`
    ),
    Schema.decodeUnknownSync(RequestFingerprint)
  );

const idempotencyKeyHash = (key: IdempotencyKey) =>
  Effect.map(
    sha256Hex(`recipe-import-intent-idempotency:v1:${key}`),
    Schema.decodeUnknownSync(IdempotencyKeyHash)
  );

const sourceLocatorHash = (request: CreateRecipeImportIntentRequest) =>
  Effect.map(
    sha256Hex(
      `recipe-import-intent-source-locator:v1:${request.source.kind}:${request.source.url}`
    ),
    Schema.decodeUnknownSync(SourceLocatorHash)
  );

const cancelMutationId = (
  principal: ImportPrincipal,
  intentId: RecipeImportIntentId,
  key: IdempotencyKey
) =>
  Effect.map(
    sha256Hex(
      `recipe-import-intent-cancel-mutation:v1:${principal.actorId}:${intentId}:${key}`
    ),
    Schema.decodeUnknownSync(ImportIntentTransitionMutationId)
  );

const cancelCommandDigest = (
  principal: ImportPrincipal,
  intentId: RecipeImportIntentId,
  request: CancelRecipeImportIntentRequest
) =>
  Effect.map(
    sha256Hex(
      `recipe-import-intent-cancel-command:v1:${principal.householdScopeId}:${principal.actorId}:${intentId}:${request.expectedIntentVersion}`
    ),
    Schema.decodeUnknownSync(ImportIntentTransitionCommandDigest)
  );

const resolveSourceMutationId = (intentId: RecipeImportIntentId) =>
  Effect.map(
    sha256Hex(`recipe-import-intent-resolve-source-mutation:v1:${intentId}`),
    Schema.decodeUnknownSync(ImportIntentTransitionMutationId)
  );

const resolveSourceCommandDigest = (
  principal: ImportPrincipal,
  input: Omit<
    ResolveImportIntentSourceCommand,
    "commandDigest" | "mutationId" | "resolvedAt"
  >
) =>
  Effect.map(
    sha256Hex(
      `recipe-import-intent-resolve-source-command:v1:${principal.householdScopeId}:${input.intentId}:${input.canonicalSourceId}:${input.canonicalUrl}:${input.sourceKind}`
    ),
    Schema.decodeUnknownSync(ImportIntentTransitionCommandDigest)
  );

export const makeImportIntentApplication = (
  repository: ImportIntentRepositoryShape,
  workflowStarter: Pick<ImportWorkflowReconcilerShape, "ensureStarted">
) => ({
  admit: Effect.fn("RecipeImportIntent.admit")(function* admit(
    principal: ImportPrincipal,
    request: CreateRecipeImportIntentRequest,
    key: IdempotencyKey
  ) {
    const generator = yield* ImportIntentIdGenerator;
    const [intentId, createdAt, keyHash, fingerprint, locatorHash] =
      yield* Effect.all([
        generator.next,
        currentInstant,
        idempotencyKeyHash(key),
        requestFingerprint(request),
        sourceLocatorHash(request),
      ]);
    return yield* repository.admitIntent({
      createdAt,
      idempotencyKeyHash: keyHash,
      intentId,
      principal,
      requestFingerprint: fingerprint,
      sourceLocatorHash: locatorHash,
      submittedSourceUrl: request.source.url,
    });
  }),
  cancel: Effect.fn("RecipeImportIntent.cancel")(function* cancel(
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId,
    request: CancelRecipeImportIntentRequest,
    key: IdempotencyKey
  ) {
    const [cancelledAt, mutationId, commandDigest] = yield* Effect.all([
      currentInstant,
      cancelMutationId(principal, intentId, key),
      cancelCommandDigest(principal, intentId, request),
    ]);
    const command = yield* Schema.decodeUnknownEffect(
      CancelImportIntentCommand,
      { onExcessProperty: "error" }
    )({
      cancelledAt: Schema.encodeSync(Instant)(cancelledAt),
      commandDigest,
      expectedIntentVersion: request.expectedIntentVersion,
      intentId,
      mutationId,
      principal,
    }).pipe(Effect.orDie);
    const result = yield* repository.cancelIntent(command);
    if (result.disposition === "applied") {
      const terminator = yield* ImportIntentWorkflowTerminator;
      yield* terminator.terminate(intentId).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          () => Effect.void
        )
      );
    }
    return result.intent;
  }),
  get: Effect.fn("RecipeImportIntent.get")(function* get(
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) {
    const stored = yield* repository.findIntent(principal, intentId);
    return yield* Option.match(stored, {
      onNone: () => Effect.fail(new RecipeImportIntentNotFound()),
      onSome: Effect.succeed,
    });
  }),
  reconcileStalledStarts: Effect.fn(
    "RecipeImportIntent.reconcileStalledStarts"
  )(function* reconcileStalledStarts(
    rawRequest: ReconcileStalledImportIntentStartsRequest
  ) {
    const request = yield* Schema.decodeUnknownEffect(
      ReconcileStalledImportIntentStartsRequest,
      { onExcessProperty: "error" }
    )(rawRequest).pipe(Effect.orDie);
    const currentTimeMillis = yield* Clock.currentTimeMillis;
    const cutoff = yield* Schema.decodeUnknownEffect(Instant)(
      new Date(currentTimeMillis - request.minimumAgeMilliseconds).toISOString()
    ).pipe(Effect.orDie);
    const candidates = yield* repository.listStalledIntentStarts(
      cutoff,
      request.limit
    );
    const summary = {
      ensured: 0,
      examined: candidates.length,
      skipped: 0,
      startFailures: 0,
    };
    for (const candidate of candidates) {
      const isCurrent = yield* repository.isIntentExecutionCurrent(
        candidate.intentId,
        candidate.executionGeneration
      );
      if (!isCurrent) {
        summary.skipped += 1;
        continue;
      }
      const importId = yield* Schema.decodeUnknownEffect(ImportId)(
        candidate.intentId
      ).pipe(Effect.orDie);
      const started = yield* workflowStarter
        .ensureStarted(importId, candidate.executionGeneration, {
          correlationId: deriveLegacyImportCorrelationId(importId),
        })
        .pipe(
          Effect.match({
            onFailure: () => false,
            onSuccess: () => true,
          })
        );
      if (started) {
        summary.ensured += 1;
      } else {
        summary.startFailures += 1;
      }
    }
    return yield* Schema.decodeUnknownEffect(
      ReconcileStalledImportIntentStartsResult
    )(summary).pipe(Effect.orDie);
  }),
  requireMutable: Effect.fn("RecipeImportIntent.requireMutable")(
    (principal: ImportPrincipal, intentId: RecipeImportIntentId) =>
      repository.requireMutableIntent(principal, intentId)
  ),
  resolveSource: Effect.fn("RecipeImportIntent.resolveSource")(
    function* resolveSource(
      principal: ImportPrincipal,
      input: Omit<
        ResolveImportIntentSourceCommand,
        "commandDigest" | "mutationId" | "resolvedAt"
      >
    ) {
      const [resolvedAt, mutationId, commandDigest] = yield* Effect.all([
        currentInstant,
        resolveSourceMutationId(input.intentId),
        resolveSourceCommandDigest(principal, input),
      ]);
      const result = yield* repository.resolveIntentSource(principal, {
        ...input,
        commandDigest,
        mutationId,
        resolvedAt,
      });
      if (result._tag === "Owner") {
        const importId = yield* Schema.decodeUnknownEffect(ImportId)(
          result.intent.id
        ).pipe(Effect.orDie);
        yield* workflowStarter.ensureStarted(
          importId,
          result.executionGeneration,
          { correlationId: deriveLegacyImportCorrelationId(importId) }
        );
      }
      return result.intent;
    }
  ),
  timeline: Effect.fn("RecipeImportIntent.timeline")(
    (principal: ImportPrincipal, intentId: RecipeImportIntentId) =>
      repository.readIntentTimeline(principal, intentId)
  ),
});

export const InitialRecipeImportIntentVersion = Schema.decodeUnknownSync(
  RecipeImportIntentVersion
)(1);

export type { RecipeImportIntent } from "@meal-planner/recipe-import-api";
