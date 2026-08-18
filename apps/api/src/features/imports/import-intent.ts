import {
  CanonicalTikTokUrl,
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
import { makeImportIntentWorkflowTransitions } from "./import-intent-workflow-transitions.js";
import type { PublicIntentFailure } from "./import-intent-workflow-transitions.js";
import type { ImportTraceContext } from "./import-observability.js";
import { ImportId, SourceDescriptor } from "./import.contracts.js";
import type {
  ImportIntentRepository,
  ResolveImportIntentSourceCommand,
} from "./import.repository.js";
import {
  IdempotencyKeyHash,
  RequestFingerprint,
  SourceLocatorHash,
  StalledImportIntentStartLimit,
} from "./import.repository.js";
import type { ImportWorkflowReconciler } from "./import.workflow.js";
import { CanonicalSourceIdentityResolver } from "./source-identity.js";

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

export const StalledImportIntentContinuationMinimumAgeMilliseconds =
  PositiveSafeInteger.pipe(
    Schema.brand("StalledImportIntentContinuationMinimumAgeMilliseconds")
  );
export type StalledImportIntentContinuationMinimumAgeMilliseconds =
  typeof StalledImportIntentContinuationMinimumAgeMilliseconds.Type;

export const ReconcileStalledImportIntentContinuationsRequest = Schema.Struct({
  limit: StalledImportIntentStartLimit,
  minimumAgeMilliseconds: StalledImportIntentContinuationMinimumAgeMilliseconds,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ReconcileStalledImportIntentContinuationsRequest =
  typeof ReconcileStalledImportIntentContinuationsRequest.Type;

export const ReconcileStalledImportIntentContinuationsResult = Schema.Struct({
  continuationFailures: NonNegativeSafeInteger,
  continued: NonNegativeSafeInteger,
  ensured: NonNegativeSafeInteger,
  examined: NonNegativeSafeInteger,
  skipped: NonNegativeSafeInteger,
  startFailures: NonNegativeSafeInteger,
});
export type ReconcileStalledImportIntentContinuationsResult =
  typeof ReconcileStalledImportIntentContinuationsResult.Type;

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

const publicFailureForSourceResolution = (
  cause: "invalid" | "unavailable" | "unsupported"
): PublicIntentFailure => {
  switch (cause) {
    case "invalid":
    case "unsupported": {
      return {
        code: "unsupported_source",
        message: "This source type is not supported.",
        recovery: "create_new_intent",
      };
    }
    case "unavailable": {
      return {
        code: "source_unavailable",
        message: "The source is temporarily unavailable.",
        recovery: "create_new_intent",
      };
    }
    default: {
      return cause satisfies never;
    }
  }
};

export const makeImportIntentApplication = (
  repository: ImportIntentRepository,
  workflowStarter: Pick<ImportWorkflowReconciler, "ensureStarted">,
  trace: ImportTraceContext
) => {
  const getIntent = Effect.fn("RecipeImportIntent.get")(function* get(
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) {
    const stored = yield* repository.findIntent(principal, intentId);
    return yield* Option.match(stored, {
      onNone: () => Effect.fail(new RecipeImportIntentNotFound()),
      onSome: Effect.succeed,
    });
  });

  const resolveIntentSourceWithTrace = Effect.fn(
    "RecipeImportIntent.resolveSourceWithTrace"
  )(function* resolveSource(
    principal: ImportPrincipal,
    input: Omit<
      ResolveImportIntentSourceCommand,
      "commandDigest" | "mutationId" | "resolvedAt"
    >,
    workflowTrace: ImportTraceContext
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
        workflowTrace
      );
    }
    return result.intent;
  });

  const resolveIntentSource = Effect.fn("RecipeImportIntent.resolveSource")(
    (
      principal: ImportPrincipal,
      input: Omit<
        ResolveImportIntentSourceCommand,
        "commandDigest" | "mutationId" | "resolvedAt"
      >
    ) => resolveIntentSourceWithTrace(principal, input, trace)
  );

  const continueSourceResolution = Effect.fn(
    "RecipeImportIntent.continueSourceResolution"
  )(function* continueIntentSourceResolution(
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) {
    const pending = yield* repository.findPendingSourceResolution(
      principal,
      intentId
    );
    if (Option.isNone(pending)) {
      return {
        disposition: "no_op" as const,
        intent: yield* getIntent(principal, intentId),
      };
    }

    const resolver = yield* CanonicalSourceIdentityResolver;
    const source = yield* Schema.decodeUnknownEffect(SourceDescriptor)({
      kind: "tiktok",
      url: pending.value.submittedSourceUrl,
    }).pipe(Effect.orDie);
    const resolution = yield* resolver.resolve(source).pipe(
      Effect.match({
        onFailure: (error) => ({ _tag: "Failure" as const, error }),
        onSuccess: (value) => ({ _tag: "Success" as const, value }),
      })
    );
    if (
      resolution._tag === "Success" &&
      resolution.value._tag === "VideoIdentity"
    ) {
      const canonicalUrl = yield* Schema.decodeUnknownEffect(
        CanonicalTikTokUrl
      )(resolution.value.videoUrl).pipe(Effect.orDie);
      return {
        disposition: "continued" as const,
        intent: yield* resolveIntentSourceWithTrace(
          principal,
          {
            canonicalSourceId: resolution.value.identity.canonicalId,
            canonicalUrl,
            intentId,
            sourceKind: "video",
          },
          pending.value.trace
        ),
      };
    }

    let failureCause: "invalid" | "unavailable" | "unsupported";
    if (resolution._tag === "Success") {
      failureCause = "unsupported";
    } else if (resolution.error._tag === "InvalidSource") {
      failureCause = "invalid";
    } else {
      failureCause = "unavailable";
    }
    const failure = publicFailureForSourceResolution(failureCause);
    const transitions = makeImportIntentWorkflowTransitions({
      executionGeneration: pending.value.executionGeneration,
      intentId,
      repository,
    });
    yield* transitions.fail("acquisition", failure);
    return {
      disposition: "failed" as const,
      intent: yield* getIntent(principal, intentId),
    };
  });

  return {
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
        trace,
      });
    }),
    admitWithRequestFingerprint: Effect.fn(
      "RecipeImportIntent.admitWithRequestFingerprint"
    )(function* admitWithRequestFingerprint(
      principal: ImportPrincipal,
      request: CreateRecipeImportIntentRequest,
      key: IdempotencyKey,
      fingerprint: RequestFingerprint
    ) {
      const generator = yield* ImportIntentIdGenerator;
      const [intentId, createdAt, keyHash, locatorHash] = yield* Effect.all([
        generator.next,
        currentInstant,
        idempotencyKeyHash(key),
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
        trace,
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
    continueSourceResolution,
    get: getIntent,
    reconcileStalledContinuations: Effect.fn(
      "RecipeImportIntent.reconcileStalledContinuations"
    )(function* reconcileStalledContinuations(
      rawRequest: ReconcileStalledImportIntentContinuationsRequest
    ) {
      const request = yield* Schema.decodeUnknownEffect(
        ReconcileStalledImportIntentContinuationsRequest,
        { onExcessProperty: "error" }
      )(rawRequest).pipe(Effect.orDie);
      const currentTimeMillis = yield* Clock.currentTimeMillis;
      const cutoff = yield* Schema.decodeUnknownEffect(Instant)(
        new Date(
          currentTimeMillis - request.minimumAgeMilliseconds
        ).toISOString()
      ).pipe(Effect.orDie);
      const sourceCandidates = yield* repository.listStalledSourceResolutions(
        cutoff,
        request.limit
      );
      const remaining = request.limit - sourceCandidates.length;
      const startCandidates =
        remaining === 0
          ? []
          : yield* repository.listStalledIntentStarts(
              cutoff,
              Schema.decodeUnknownSync(StalledImportIntentStartLimit)(remaining)
            );
      const summary = {
        continuationFailures: 0,
        continued: 0,
        ensured: 0,
        examined: sourceCandidates.length + startCandidates.length,
        skipped: 0,
        startFailures: 0,
      };
      for (const candidate of sourceCandidates) {
        const disposition = yield* continueSourceResolution(
          candidate.principal,
          candidate.intentId
        ).pipe(
          Effect.match({
            onFailure: () => "failure" as const,
            onSuccess: (result) => result.disposition,
          })
        );
        if (disposition === "continued" || disposition === "failed") {
          summary.continued += 1;
        } else if (disposition === "failure") {
          summary.continuationFailures += 1;
        } else {
          summary.skipped += 1;
        }
      }
      for (const candidate of startCandidates) {
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
          .ensureStarted(
            importId,
            candidate.executionGeneration,
            candidate.trace
          )
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
        ReconcileStalledImportIntentContinuationsResult
      )(summary).pipe(Effect.orDie);
    }),
    requireMutable: Effect.fn("RecipeImportIntent.requireMutable")(
      (principal: ImportPrincipal, intentId: RecipeImportIntentId) =>
        repository.requireMutableIntent(principal, intentId)
    ),
    resolveSource: resolveIntentSource,
    timeline: Effect.fn("RecipeImportIntent.timeline")(
      (principal: ImportPrincipal, intentId: RecipeImportIntentId) =>
        repository.readIntentTimeline(principal, intentId)
    ),
  };
};

export const InitialRecipeImportIntentVersion = Schema.decodeUnknownSync(
  RecipeImportIntentVersion
)(1);

export type { RecipeImportIntent } from "@meal-planner/recipe-import-api";
