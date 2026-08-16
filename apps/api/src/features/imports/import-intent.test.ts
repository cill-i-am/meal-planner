import {
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  Instant,
  ProcessingRecipeImportIntent,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Cause, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  HouseholdScopeId,
  ImportActorId,
  ImportIntentIdGenerator,
  LegacyPrivateImportPrincipal,
  RecipeImportIntentIdempotencyConflict,
  makeImportIntentApplication,
} from "./import-intent.js";
import { makeImportAuthorizer } from "./import.auth.js";
import type {
  AdmitImportIntentResult,
  ImportIntentRepositoryShape,
  StoredImportIntentRequest,
} from "./import.repository.js";

const decodeRequest = Schema.decodeUnknownSync(CreateRecipeImportIntentRequest);
const decodeKey = Schema.decodeUnknownSync(IdempotencyKey);
const decodeIntentId = Schema.decodeUnknownSync(RecipeImportIntentId);
const firstIntentId = decodeIntentId("00000000-0000-4000-8000-000000000001");
const secondIntentId = decodeIntentId("00000000-0000-4000-8000-000000000002");
const thirdIntentId = decodeIntentId("00000000-0000-4000-8000-000000000003");
const submittedUrl = "https://www.tiktok.com/@cook/video/7520000000000001001";

const makeRecordingRepository = (): {
  readonly admissions: StoredImportIntentRequest[];
  readonly repository: ImportIntentRepositoryShape;
} => {
  const admissions: StoredImportIntentRequest[] = [];
  const intents = new Map<string, AdmitImportIntentResult["intent"]>();
  const requests = new Map<string, StoredImportIntentRequest>();

  return {
    admissions,
    repository: {
      admitIntent: (command) =>
        Effect.suspend<
          AdmitImportIntentResult,
          RecipeImportIntentIdempotencyConflict,
          never
        >(() => {
          const requestKey = `${command.principal.householdScopeId}:${command.idempotencyKeyHash}`;
          const existing = requests.get(requestKey);
          if (existing !== undefined) {
            return existing.requestFingerprint === command.requestFingerprint
              ? Effect.succeed({
                  disposition: "idempotency_replay" as const,
                  intent: existing.intent,
                })
              : Effect.fail(new RecipeImportIntentIdempotencyConflict());
          }
          const createdAt = Schema.encodeSync(Instant)(command.createdAt);
          const intent = Schema.decodeUnknownSync(ProcessingRecipeImportIntent)(
            {
              activity: { type: "working" as const },
              createdAt,
              id: command.intentId,
              intentVersion: 1,
              links: {
                self: `/v1/recipe-import-intents/${command.intentId}` as const,
                timeline:
                  `/v1/recipe-import-intents/${command.intentId}/timeline` as const,
              },
              object: "recipe_import_intent" as const,
              processing: {
                startedAt: createdAt,
                type: "resolving_source" as const,
              },
              source: {
                kind: "tiktok" as const,
                resolution: "pending" as const,
              },
              status: "processing" as const,
              updatedAt: createdAt,
            }
          );
          const stored = {
            idempotencyKeyHash: command.idempotencyKeyHash,
            intent,
            requestFingerprint: command.requestFingerprint,
          };
          admissions.push(stored);
          intents.set(
            `${command.principal.householdScopeId}:${command.intentId}`,
            intent
          );
          requests.set(requestKey, stored);
          return Effect.succeed({ disposition: "created" as const, intent });
        }),
      cancelIntent: () => Effect.die("not used by this tracer"),
      findIntent: (principal, intentId) =>
        Effect.succeed(
          Option.fromNullishOr(
            intents.get(`${principal.householdScopeId}:${intentId}`)
          )
        ),
      requireMutableIntent: (principal, intentId) =>
        Effect.flatMap(
          Effect.succeed(
            Option.fromNullishOr(
              intents.get(`${principal.householdScopeId}:${intentId}`)
            )
          ),
          Option.match({
            onNone: () =>
              Effect.fail({ _tag: "RecipeImportIntentNotFound" } as const),
            onSome: Effect.succeed,
          })
        ),
      readIntentTimeline: () => Effect.die("not used by this tracer"),
      resolveIntentSource: () => Effect.die("not used by this tracer"),
      transitionIntent: () => Effect.die("not used by this tracer"),
    },
  };
};

describe("recipe import intent application foundation", () => {
  it("uses Effect Clock and ID services for immediate unresolved admission and exact replay", async () => {
    const recording = makeRecordingRepository();
    const application = makeImportIntentApplication(recording.repository);
    const ids = [firstIntentId, secondIntentId, thirdIntentId];
    const idLayer = Layer.succeed(
      ImportIntentIdGenerator,
      ImportIntentIdGenerator.of({
        next: Effect.sync(() => {
          const next = ids.shift();
          if (next === undefined) {
            throw new Error("intent ID fixture exhausted");
          }
          return next;
        }),
      })
    );
    const request = decodeRequest({
      source: { kind: "tiktok", url: submittedUrl },
    });
    const key = decodeKey("intent-key-1");

    const [created, replay, conflict] = await Effect.runPromise(
      Effect.gen(function* admissionTracer() {
        yield* TestClock.setTime(Date.parse("2026-08-16T10:00:00.000Z"));
        const admitted = yield* application.admit(
          LegacyPrivateImportPrincipal,
          request,
          key
        );
        const replayResult = yield* application.admit(
          LegacyPrivateImportPrincipal,
          request,
          key
        );
        const conflictResult = yield* Effect.exit(
          application.admit(
            LegacyPrivateImportPrincipal,
            decodeRequest({
              source: {
                kind: "tiktok",
                url: "https://www.tiktok.com/@cook/video/7520000000000001002",
              },
            }),
            key
          )
        );
        return [admitted, replayResult, conflictResult] as const;
      }).pipe(Effect.provide([idLayer, TestClock.layer()]))
    );

    expect(created.disposition).toBe("created");
    expect(created.intent).toMatchObject({
      id: firstIntentId,
      intentVersion: 1,
      processing: { type: "resolving_source" },
      source: { resolution: "pending" },
      status: "processing",
    });
    expect(replay).toEqual({
      disposition: "idempotency_replay",
      intent: created.intent,
    });
    expect(recording.admissions).toHaveLength(1);
    expect(Exit.isFailure(conflict)).toBe(true);
    if (Exit.isFailure(conflict)) {
      const error = Option.getOrThrow(Cause.findErrorOption(conflict.cause));
      expect(error).toMatchObject({
        _tag: "RecipeImportIntentIdempotencyConflict",
      });
      expect(JSON.stringify(error)).not.toContain("tiktok.com");
    }
  });

  it("returns one stable opaque private principal without deriving it from bearer material", async () => {
    const authorizer = await Effect.runPromise(
      makeImportAuthorizer(Redacted.make("intent-secret"))
    );

    const principal = await Effect.runPromise(
      authorizer.authorize("Bearer intent-secret")
    );

    expect(principal).toEqual(LegacyPrivateImportPrincipal);
    expect(
      Schema.is(HouseholdScopeId)(principal.householdScopeId) &&
        Schema.is(ImportActorId)(principal.actorId)
    ).toBe(true);
    expect(JSON.stringify(principal)).not.toContain("intent-secret");
  });
});
