import {
  Instant,
  RecipeImportIntentId,
  RecipeImportIntentVersion,
  RecipeImportRedirect,
  RedirectedRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import type {
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportRedirect as RecipeImportRedirectType,
  RedirectedRecipeImportIntent as RedirectedRecipeImportIntentType,
} from "@meal-planner/recipe-import-api";
import { Clock, Context, Effect, Layer, Option, Schema } from "effect";

import type {
  ImportIntentRepositoryShape,
  ResolveImportIntentSourceCommand,
} from "./import.repository.js";
import {
  IdempotencyKeyHash,
  RequestFingerprint,
  SourceLocatorHash,
} from "./import.repository.js";

const OpaqueSha256 = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

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

export const makeImportIntentApplication = (
  repository: ImportIntentRepositoryShape
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
  requireMutable: Effect.fn("RecipeImportIntent.requireMutable")(
    (principal: ImportPrincipal, intentId: RecipeImportIntentId) =>
      repository.requireMutableIntent(principal, intentId)
  ),
  resolveSource: Effect.fn("RecipeImportIntent.resolveSource")(
    function* resolveSource(
      principal: ImportPrincipal,
      input: Omit<ResolveImportIntentSourceCommand, "resolvedAt">
    ) {
      const resolvedAt = yield* currentInstant;
      return yield* repository.resolveIntentSource(principal, {
        ...input,
        resolvedAt,
      });
    }
  ),
});

export const InitialRecipeImportIntentVersion = Schema.decodeUnknownSync(
  RecipeImportIntentVersion
)(1);

export type { RecipeImportIntent } from "@meal-planner/recipe-import-api";
