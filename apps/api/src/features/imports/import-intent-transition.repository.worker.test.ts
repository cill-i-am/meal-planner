import {
  CancelRecipeImportIntentRequest,
  CanonicalTikTokUrl,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  Instant,
  RecipeImportActionId,
  RecipeImportIntentId,
  RecipeImportTimeline,
} from "@meal-planner/recipe-import-api";
import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { ImportIntentWorkflowTerminator } from "./import-intent-execution.js";
import { ImportIntentTransitionCommand } from "./import-intent-transition.js";
import {
  ImportIntentIdGenerator,
  ImportPrincipal,
  makeImportIntentApplication,
} from "./import-intent.js";
import { SourceCanonicalId } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import { TestImportTrace } from "./import.test-fixtures.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const decodeRequest = Schema.decodeUnknownSync(CreateRecipeImportIntentRequest);
const decodeCancelRequest = Schema.decodeUnknownSync(
  CancelRecipeImportIntentRequest
);
const decodeKey = Schema.decodeUnknownSync(IdempotencyKey);
const decodeCanonicalUrl = Schema.decodeUnknownSync(CanonicalTikTokUrl);
const decodeIntentId = Schema.decodeUnknownSync(RecipeImportIntentId);
const decodeActionId = Schema.decodeUnknownSync(RecipeImportActionId);
const decodeCanonicalSourceId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodePrincipal = Schema.decodeUnknownSync(ImportPrincipal);
const decodeTransition = Schema.decodeUnknownSync(
  ImportIntentTransitionCommand,
  { onExcessProperty: "error" }
);
const encodeTransition = Schema.encodeSync(ImportIntentTransitionCommand);
const encodeTimeline = Schema.encodeSync(RecipeImportTimeline);
const workflowStarter = {
  ensureStarted: () => Effect.succeed("already_active" as const),
};

const keysOf = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(keysOf);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...keysOf(nested),
  ]);
};

const principal = decodePrincipal({
  actorId: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  householdScopeId:
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
});

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("recipe import intent transition repository in workerd", () => {
  it.each([
    ["speech", "visuals", 301],
    ["visuals", "speech", 302],
  ] as const)(
    "atomically converges %s then %s with fenced replay-safe history",
    async (first, second, ordinal) => {
      const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
      const intentId = decodeIntentId(
        `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`
      );
      const idLayer = Layer.succeed(
        ImportIntentIdGenerator,
        ImportIntentIdGenerator.of({ next: Effect.succeed(intentId) })
      );
      const application = makeImportIntentApplication(
        repository,
        workflowStarter,
        TestImportTrace
      );
      const run = <A, E>(
        effect: Effect.Effect<A, E, ImportIntentIdGenerator>
      ) =>
        Effect.runPromise(
          effect.pipe(Effect.provide([idLayer, TestClock.layer()]))
        );

      await run(
        Effect.gen(function* transitionTracer() {
          yield* TestClock.setTime(Date.parse("2026-08-16T15:00:00.000Z"));
          const admitted = yield* application.admit(
            principal,
            decodeRequest({
              source: {
                kind: "tiktok",
                url: `https://www.tiktok.com/t/ZTRANSITION${ordinal}`,
              },
            }),
            decodeKey(`transition-${ordinal}`)
          );
          yield* application.resolveSource(principal, {
            canonicalSourceId: decodeCanonicalSourceId(
              `${7_520_000_000_000_001_000n + BigInt(ordinal)}`
            ),
            canonicalUrl: decodeCanonicalUrl(
              `https://www.tiktok.com/@cook/video/${7_520_000_000_000_001_000n + BigInt(ordinal)}`
            ),
            intentId: admitted.intent.id,
            sourceKind: "video",
          });

          const command = (
            commandOrdinal: number,
            body:
              | {
                  readonly _tag: "AdvanceStage";
                  readonly stage: "analyzing_evidence";
                }
              | {
                  readonly _tag: "AdvanceComponent";
                  readonly component: "speech" | "visuals";
                  readonly progress: "processing" | "completed";
                }
          ) =>
            decodeTransition({
              ...body,
              commandDigest: commandOrdinal.toString(16).padStart(64, "0"),
              executionGeneration: 1,
              intentId,
              mutationId: (commandOrdinal + 1000)
                .toString(16)
                .padStart(64, "0"),
              occurredAt: `2026-08-16T15:00:${commandOrdinal
                .toString()
                .padStart(2, "0")}.000Z`,
            });

          const stageCommand = command(1, {
            _tag: "AdvanceStage",
            stage: "analyzing_evidence",
          });
          const appliedStage = yield* repository.transitionIntent(stageCommand);
          expect(appliedStage).toMatchObject({
            _tag: "Applied",
            snapshot: { intentVersion: 3, stage: "analyzing_evidence" },
          });
          const replayedStage =
            yield* repository.transitionIntent(stageCommand);
          expect(replayedStage).toMatchObject({
            _tag: "NoOp",
            reason: "replayed_mutation",
            snapshot: {
              intentVersion: 3,
              stageStartedAt: appliedStage.snapshot.stageStartedAt,
              updatedAt: appliedStage.snapshot.updatedAt,
            },
          });

          const changedDigest = yield* Effect.exit(
            repository.transitionIntent(
              decodeTransition({
                ...encodeTransition(stageCommand),
                commandDigest: "f".repeat(64),
              })
            )
          );
          expect(Exit.isFailure(changedDigest)).toBe(true);
          if (Exit.isFailure(changedDigest)) {
            expect(
              Option.getOrThrow(Cause.findErrorOption(changedDigest.cause))
            ).toMatchObject({ _tag: "ImportIntentTransitionMutationConflict" });
          }

          const distinctRace = yield* Effect.all(
            [
              repository.transitionIntent(
                command(2, {
                  _tag: "AdvanceComponent",
                  component: first,
                  progress: "processing",
                })
              ),
              repository.transitionIntent(
                command(3, {
                  _tag: "AdvanceComponent",
                  component: second,
                  progress: "processing",
                })
              ),
            ],
            { concurrency: "unbounded" }
          );
          expect(distinctRace.map(({ _tag }) => _tag)).toEqual([
            "Applied",
            "Applied",
          ]);

          const exactRaceCommand = command(4, {
            _tag: "AdvanceComponent",
            component: first,
            progress: "completed",
          });
          const exactRace = yield* Effect.all(
            [
              repository.transitionIntent(exactRaceCommand),
              repository.transitionIntent(exactRaceCommand),
            ],
            { concurrency: "unbounded" }
          );
          expect(
            exactRace
              .map((outcome) =>
                outcome._tag === "NoOp"
                  ? `${outcome._tag}:${outcome.reason}`
                  : outcome._tag
              )
              .toSorted()
          ).toEqual(["Applied", "NoOp:replayed_mutation"]);

          const digestRaceCommand = command(5, {
            _tag: "AdvanceComponent",
            component: second,
            progress: "completed",
          });
          const digestRace = yield* Effect.all(
            [
              Effect.exit(repository.transitionIntent(digestRaceCommand)),
              Effect.exit(
                repository.transitionIntent(
                  decodeTransition({
                    ...encodeTransition(digestRaceCommand),
                    commandDigest: "e".repeat(64),
                  })
                )
              ),
            ],
            { concurrency: "unbounded" }
          );
          expect(digestRace.filter(Exit.isSuccess)).toHaveLength(1);
          expect(digestRace.filter(Exit.isFailure)).toHaveLength(1);
          const digestLoser = digestRace.find(Exit.isFailure);
          if (digestLoser !== undefined && Exit.isFailure(digestLoser)) {
            expect(
              Option.getOrThrow(Cause.findErrorOption(digestLoser.cause))
            ).toMatchObject({ _tag: "ImportIntentTransitionMutationConflict" });
          }

          const stale = yield* repository.transitionIntent(
            decodeTransition({
              ...encodeTransition(
                command(20, {
                  _tag: "AdvanceComponent",
                  component: "speech",
                  progress: "completed",
                })
              ),
              executionGeneration: 0,
            })
          );
          expect(stale).toMatchObject({
            _tag: "NoOp",
            reason: "stale_generation",
          });
          const future = yield* repository.transitionIntent(
            decodeTransition({
              ...encodeTransition(
                command(21, {
                  _tag: "AdvanceComponent",
                  component: "speech",
                  progress: "completed",
                })
              ),
              executionGeneration: 2,
            })
          );
          expect(future).toMatchObject({
            _tag: "Rejected",
            reason: "future_generation",
          });

          const reconstructed = yield* application.get(principal, intentId);
          expect(reconstructed).toMatchObject({
            intentVersion: 7,
            processing: {
              speech: "completed",
              type: "analyzing_evidence",
              visuals: "completed",
            },
          });
          const persisted = yield* Effect.promise(() =>
            testEnv.MealPlannerDatabase.prepare(
              `SELECT i.intent_version, i.public_speech, i.public_visuals,
                      i.updated_at,
                      (SELECT count(*) FROM recipe_import_intent_history h
                        WHERE h.intent_id = i.id) AS history_count,
                      (SELECT max(h.intent_version)
                         FROM recipe_import_intent_history h
                        WHERE h.intent_id = i.id) AS history_version
                 FROM recipe_imports i WHERE i.id = ?`
            )
              .bind(intentId)
              .first<{
                history_count: number;
                history_version: number;
                intent_version: number;
                public_speech: string;
                public_visuals: string;
                updated_at: string;
              }>()
          );
          expect(persisted).toEqual({
            history_count: 7,
            history_version: 7,
            intent_version: 7,
            public_speech: "completed",
            public_visuals: "completed",
            updated_at: "2026-08-16T15:00:05.000Z",
          });
          const zeroRowUpdate = yield* Effect.promise(
            () =>
              testEnv.MealPlannerDatabase.prepare(
                "UPDATE recipe_imports SET updated_at = updated_at WHERE id = ?"
              )
                .bind("00000000-0000-4000-8000-999999999999")
                .run() as PromiseLike<{
                readonly meta: { readonly changes: number };
              }>
          );
          expect(zeroRowUpdate.meta.changes).toBe(0);
        })
      );
    }
  );

  it("persists replay-stable retry recovery and safe terminal failure", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const intentId = decodeIntentId("00000000-0000-4000-8000-000000000303");
    const idLayer = Layer.succeed(
      ImportIntentIdGenerator,
      ImportIntentIdGenerator.of({ next: Effect.succeed(intentId) })
    );
    const application = makeImportIntentApplication(
      repository,
      workflowStarter,
      TestImportTrace
    );
    const run = <A, E>(effect: Effect.Effect<A, E, ImportIntentIdGenerator>) =>
      Effect.runPromise(
        effect.pipe(Effect.provide([idLayer, TestClock.layer()]))
      );
    const command = (ordinal: number, body: Record<string, unknown>) =>
      decodeTransition({
        ...body,
        commandDigest: ordinal.toString(16).padStart(64, "0"),
        executionGeneration: 1,
        intentId,
        mutationId: (ordinal + 2000).toString(16).padStart(64, "0"),
        occurredAt: `2026-08-16T15:10:${ordinal
          .toString()
          .padStart(2, "0")}.000Z`,
      });

    await run(
      Effect.gen(function* retryFailureTracer() {
        yield* TestClock.setTime(Date.parse("2026-08-16T15:10:00.000Z"));
        const admitted = yield* application.admit(
          principal,
          decodeRequest({
            source: {
              kind: "tiktok",
              url: "https://www.tiktok.com/t/ZRETRYFAILURE303",
            },
          }),
          decodeKey("transition-retry-failure-303")
        );
        yield* application.resolveSource(principal, {
          canonicalSourceId: decodeCanonicalSourceId("7520000000000001303"),
          canonicalUrl: decodeCanonicalUrl(
            "https://www.tiktok.com/@cook/video/7520000000000001303"
          ),
          intentId: admitted.intent.id,
          sourceKind: "video",
        });
        yield* repository.transitionIntent(
          command(1, {
            _tag: "AdvanceStage",
            stage: "analyzing_evidence",
          })
        );
        yield* repository.transitionIntent(
          command(2, {
            _tag: "AdvanceComponent",
            component: "speech",
            progress: "processing",
          })
        );

        const retryCommand = command(3, {
          _tag: "SetActivity",
          activity: "retrying",
          attempt: 1,
          boundary: "speech",
        });
        const retrying = yield* repository.transitionIntent(retryCommand);
        expect(retrying).toMatchObject({
          _tag: "Applied",
          snapshot: {
            activity: "retrying",
            intentVersion: 5,
            speech: "processing",
            stage: "analyzing_evidence",
            visuals: "not_started",
          },
        });
        const retryReplay = yield* repository.transitionIntent(retryCommand);
        expect(retryReplay).toMatchObject({
          _tag: "NoOp",
          reason: "replayed_mutation",
          snapshot: { intentVersion: 5 },
        });

        yield* repository.transitionIntent(
          command(4, {
            _tag: "SetActivity",
            activity: "working",
            attempt: 2,
            boundary: "speech",
          })
        );
        const failureCommand = command(5, {
          _tag: "Fail",
          boundary: "speech",
          code: "analysis_failed",
          message: "The source could not be analyzed.",
          recovery: "create_new_intent",
        });
        const failed = yield* repository.transitionIntent(failureCommand);
        expect(failed).toMatchObject({
          _tag: "Applied",
          snapshot: { intentVersion: 7, status: "failed" },
        });
        const failedReplay = yield* repository.transitionIntent(failureCommand);
        expect(failedReplay).toMatchObject({
          _tag: "NoOp",
          reason: "replayed_mutation",
          snapshot: {
            failedAt: failed.snapshot.failedAt,
            intentVersion: 7,
            updatedAt: failed.snapshot.updatedAt,
          },
        });
        const afterFailure = yield* repository.transitionIntent(
          command(6, {
            _tag: "SetActivity",
            activity: "working",
            attempt: 2,
            boundary: "speech",
          })
        );
        expect(afterFailure).toMatchObject({
          _tag: "NoOp",
          reason: "terminal_state",
          snapshot: {
            failedAt: failed.snapshot.failedAt,
            intentVersion: 7,
            status: "failed",
          },
        });

        const projected = yield* application.get(principal, intentId);
        expect(projected).toMatchObject({
          error: {
            code: "analysis_failed",
            message: "The source could not be analyzed.",
            recovery: "create_new_intent",
          },
          failedAt: failed.snapshot.failedAt,
          intentVersion: 7,
          status: "failed",
        });
        const events = yield* Effect.promise(
          () =>
            testEnv.MealPlannerDatabase.prepare(
              `SELECT event_type, intent_version, public_stage,
                    public_activity, public_speech, public_visuals, failure_code
               FROM recipe_import_intent_history
              WHERE intent_id = ? AND intent_version >= 5
              ORDER BY intent_version`
            )
              .bind(intentId)
              .all<{
                event_type: string;
                failure_code: string | null;
                intent_version: number;
                public_activity: string | null;
                public_speech: string | null;
                public_stage: string | null;
                public_visuals: string | null;
              }>() as PromiseLike<{
              readonly results: readonly {
                readonly event_type: string;
                readonly failure_code: string | null;
                readonly intent_version: number;
                readonly public_activity: string | null;
                readonly public_speech: string | null;
                readonly public_stage: string | null;
                readonly public_visuals: string | null;
              }[];
            }>
        );
        expect(events.results).toEqual([
          {
            event_type: "retrying",
            failure_code: null,
            intent_version: 5,
            public_activity: "retrying",
            public_speech: "processing",
            public_stage: "analyzing_evidence",
            public_visuals: "not_started",
          },
          {
            event_type: "recovered",
            failure_code: null,
            intent_version: 6,
            public_activity: "working",
            public_speech: "processing",
            public_stage: "analyzing_evidence",
            public_visuals: "not_started",
          },
          {
            event_type: "intent_failed",
            failure_code: "analysis_failed",
            intent_version: 7,
            public_activity: null,
            public_speech: null,
            public_stage: null,
            public_visuals: null,
          },
        ]);

        const timeline = yield* application.timeline(principal, intentId);
        const encodedTimeline = encodeTimeline(timeline);
        expect(
          encodedTimeline.data.map(({ at, intentVersion, type }) => ({
            at,
            intentVersion,
            type,
          }))
        ).toEqual([
          {
            at: "2026-08-16T15:10:00.000Z",
            intentVersion: 1,
            type: "intent_admitted",
          },
          {
            at: "2026-08-16T15:10:00.000Z",
            intentVersion: 2,
            type: "source_resolved",
          },
          {
            at: "2026-08-16T15:10:01.000Z",
            intentVersion: 3,
            type: "processing_stage_changed",
          },
          {
            at: "2026-08-16T15:10:02.000Z",
            intentVersion: 4,
            type: "processing_stage_changed",
          },
          {
            at: "2026-08-16T15:10:03.000Z",
            intentVersion: 5,
            type: "retrying",
          },
          {
            at: "2026-08-16T15:10:04.000Z",
            intentVersion: 6,
            type: "recovered",
          },
          {
            at: "2026-08-16T15:10:05.000Z",
            intentVersion: 7,
            type: "intent_failed",
          },
        ]);
        expect(
          encodeTimeline(
            yield* makeImportIntentApplication(
              makeD1ImportRepository(testEnv.MealPlannerDatabase),
              workflowStarter,
              TestImportTrace
            ).timeline(principal, intentId)
          )
        ).toEqual(encodedTimeline);
        const encodedTimelineText = JSON.stringify(encodedTimeline);
        expect(encodedTimelineText).not.toContain(
          "https://www.tiktok.com/t/ZRETRYFAILURE303"
        );
        expect(encodedTimelineText).not.toContain(principal.actorId);
        for (const forbidden of [
          "actorCategory",
          "actorIdentityHash",
          "commandDigest",
          "mutationId",
          "provider",
          "rawUrl",
          "transcript",
        ]) {
          expect(keysOf(encodedTimeline)).not.toContain(forbidden);
        }

        const otherPrincipal = decodePrincipal({
          actorId:
            "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          householdScopeId:
            "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        });
        for (const hiddenId of [
          intentId,
          decodeIntentId("00000000-0000-4000-8000-888888888888"),
        ]) {
          const hiddenTimeline = yield* Effect.exit(
            application.timeline(otherPrincipal, hiddenId)
          );
          expect(hiddenTimeline._tag).toBe("Failure");
          if (Exit.isFailure(hiddenTimeline)) {
            expect(
              Option.getOrThrow(Cause.findErrorOption(hiddenTimeline.cause))
            ).toMatchObject({ _tag: "RecipeImportIntentNotFound" });
          }
        }

        yield* Effect.promise(() =>
          testEnv.MealPlannerDatabase.prepare(
            `INSERT INTO recipe_import_intent_history (
               intent_id, intent_version, event_type, occurred_at,
               actor_category, to_public_status, public_status
             ) VALUES (?, 8, 'processing_stage_changed', ?, 'system',
                       'processing', 'processing')`
          )
            .bind(intentId, "2026-08-16T15:10:08.000Z")
            .run()
        );
        const corruptTimeline = yield* Effect.exit(
          application.timeline(principal, intentId)
        );
        expect(corruptTimeline._tag).toBe("Failure");
        if (Exit.isFailure(corruptTimeline)) {
          expect(
            Option.getOrThrow(Cause.findErrorOption(corruptTimeline.cause))
          ).toMatchObject({ _tag: "ImportPersistenceCorrupt" });
        }
      })
    );
  });

  it("commits cancellation before one best-effort termination and classifies every replay conflict", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const ids = [304, 305, 306].map((ordinal) =>
      decodeIntentId(
        `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`
      )
    );
    const pendingIds = [...ids];
    const idLayer = Layer.succeed(
      ImportIntentIdGenerator,
      ImportIntentIdGenerator.of({
        next: Effect.sync(() => {
          const next = pendingIds.shift();
          if (next === undefined) {
            throw new Error("intent cancellation fixture exhausted its IDs");
          }
          return next;
        }),
      })
    );
    const terminationSnapshots: unknown[] = [];
    const terminatorLayer = Layer.succeed(
      ImportIntentWorkflowTerminator,
      ImportIntentWorkflowTerminator.of({
        terminate: (intentId) =>
          Effect.promise(() =>
            testEnv.MealPlannerDatabase.prepare(
              `SELECT public_status, intent_version,
                      (SELECT count(*) FROM recipe_import_intent_history
                        WHERE intent_id = ? AND event_type = 'intent_cancelled')
                        AS cancellation_events
                 FROM recipe_imports WHERE id = ?`
            )
              .bind(intentId, intentId)
              .first()
          ).pipe(
            Effect.tap((snapshot) =>
              Effect.sync(() => {
                terminationSnapshots.push(snapshot);
              })
            ),
            Effect.andThen(Effect.fail("workflow termination unavailable"))
          ),
      })
    );
    const application = makeImportIntentApplication(
      repository,
      workflowStarter,
      TestImportTrace
    );
    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        ImportIntentIdGenerator | ImportIntentWorkflowTerminator
      >
    ) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide([idLayer, terminatorLayer, TestClock.layer()])
        )
      );
    const [intentId] = ids;
    if (intentId === undefined) {
      throw new Error("missing cancellation fixture ID");
    }

    await run(
      Effect.gen(function* cancellationTracer() {
        yield* TestClock.setTime(Date.parse("2026-08-16T15:20:00.000Z"));
        yield* application.admit(
          principal,
          decodeRequest({
            source: {
              kind: "tiktok",
              url: "https://www.tiktok.com/t/ZCANCEL304",
            },
          }),
          decodeKey("cancel-admission-304")
        );
        yield* application.resolveSource(principal, {
          canonicalSourceId: decodeCanonicalSourceId("7520000000000001304"),
          canonicalUrl: decodeCanonicalUrl(
            "https://www.tiktok.com/@cook/video/7520000000000001304"
          ),
          intentId,
          sourceKind: "video",
        });
        const delayedGate = yield* Deferred.make<null>();
        const delayedTransition = decodeTransition({
          _tag: "AdvanceStage",
          commandDigest: "a".repeat(64),
          executionGeneration: 1,
          intentId,
          mutationId: "b".repeat(64),
          occurredAt: "2026-08-16T15:20:02.000Z",
          stage: "analyzing_evidence",
        });
        const delayedFiber = yield* Effect.forkChild(
          Deferred.await(delayedGate).pipe(
            Effect.andThen(repository.transitionIntent(delayedTransition))
          )
        );

        yield* TestClock.setTime(Date.parse("2026-08-16T15:20:01.000Z"));
        const request = decodeCancelRequest({ expectedIntentVersion: 2 });
        const key = decodeKey("cancel-mutation-304");
        const cancelled = yield* application.cancel(
          principal,
          intentId,
          request,
          key
        );
        expect(cancelled).toMatchObject({
          cancelledAt: Schema.decodeUnknownSync(Instant)(
            "2026-08-16T15:20:01.000Z"
          ),
          intentVersion: 3,
          status: "cancelled",
        });
        expect(terminationSnapshots).toEqual([
          {
            cancellation_events: 1,
            intent_version: 3,
            public_status: "cancelled",
          },
        ]);

        yield* Deferred.succeed(delayedGate, null);
        expect(yield* Fiber.join(delayedFiber)).toMatchObject({
          _tag: "NoOp",
          reason: "terminal_state",
          snapshot: { intentVersion: 3, status: "cancelled" },
        });

        yield* TestClock.setTime(Date.parse("2026-08-16T15:20:05.000Z"));
        expect(
          yield* application.cancel(principal, intentId, request, key)
        ).toEqual(cancelled);
        expect(terminationSnapshots).toHaveLength(1);

        const changedDigest = yield* Effect.exit(
          application.cancel(
            principal,
            intentId,
            decodeCancelRequest({ expectedIntentVersion: 3 }),
            key
          )
        );
        expect(changedDigest._tag).toBe("Failure");
        if (Exit.isFailure(changedDigest)) {
          expect(
            Option.getOrThrow(Cause.findErrorOption(changedDigest.cause))
          ).toMatchObject({
            _tag: "ImportIntentTransitionMutationConflict",
          });
        }
        const staleVersion = yield* Effect.exit(
          application.cancel(
            principal,
            intentId,
            request,
            decodeKey("cancel-different-key-304")
          )
        );
        expect(staleVersion._tag).toBe("Failure");
        if (Exit.isFailure(staleVersion)) {
          expect(
            Option.getOrThrow(Cause.findErrorOption(staleVersion.cause))
          ).toMatchObject({ _tag: "RecipeImportIntentVersionConflict" });
        }

        const otherPrincipal = decodePrincipal({
          actorId:
            "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          householdScopeId:
            "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        });
        for (const hiddenId of [
          intentId,
          decodeIntentId("00000000-0000-4000-8000-999999999999"),
        ]) {
          const hidden = yield* Effect.exit(
            application.cancel(
              otherPrincipal,
              hiddenId,
              request,
              decodeKey(`hidden-cancel-${hiddenId}`)
            )
          );
          expect(hidden._tag).toBe("Failure");
          if (Exit.isFailure(hidden)) {
            expect(
              Option.getOrThrow(Cause.findErrorOption(hidden.cause))
            ).toMatchObject({ _tag: "RecipeImportIntentNotFound" });
          }
        }

        const [, winnerId, redirectedId] = ids;
        if (winnerId === undefined || redirectedId === undefined) {
          return yield* Effect.die("missing redirected cancellation IDs");
        }
        yield* application.admit(
          principal,
          decodeRequest({
            source: {
              kind: "tiktok",
              url: "https://www.tiktok.com/t/ZCANCELWINNER305",
            },
          }),
          decodeKey("cancel-winner-305")
        );
        yield* application.resolveSource(principal, {
          canonicalSourceId: decodeCanonicalSourceId("7520000000000001305"),
          canonicalUrl: decodeCanonicalUrl(
            "https://www.tiktok.com/@cook/video/7520000000000001305"
          ),
          intentId: winnerId,
          sourceKind: "video",
        });
        yield* application.admit(
          principal,
          decodeRequest({
            source: {
              kind: "tiktok",
              url: "https://www.tiktok.com/t/ZCANCELREDIRECT306",
            },
          }),
          decodeKey("cancel-redirect-306")
        );
        const redirected = yield* application.resolveSource(principal, {
          canonicalSourceId: decodeCanonicalSourceId("7520000000000001305"),
          canonicalUrl: decodeCanonicalUrl(
            "https://www.tiktok.com/@cook/video/7520000000000001305"
          ),
          intentId: redirectedId,
          sourceKind: "video",
        });
        expect(redirected.status).toBe("redirected");
        const redirectCancel = yield* Effect.exit(
          application.cancel(
            principal,
            redirectedId,
            decodeCancelRequest({ expectedIntentVersion: 2 }),
            decodeKey("cancel-redirected-306")
          )
        );
        expect(redirectCancel._tag).toBe("Failure");
        if (Exit.isFailure(redirectCancel)) {
          expect(
            Option.getOrThrow(Cause.findErrorOption(redirectCancel.cause))
          ).toMatchObject({
            _tag: "RecipeImportIntentRedirected",
            redirect: { intentId: winnerId },
          });
        }
        expect(terminationSnapshots).toHaveLength(1);
        const redirectedTimeline = encodeTimeline(
          yield* application.timeline(principal, redirectedId)
        );
        expect(
          redirectedTimeline.data.map(({ intentVersion, type }) => ({
            intentVersion,
            type,
          }))
        ).toEqual([
          { intentVersion: 1, type: "intent_admitted" },
          { intentVersion: 2, type: "intent_redirected" },
        ]);
        expect(redirectedTimeline.data[1]).toMatchObject({
          redirect: { intentId: winnerId },
          type: "intent_redirected",
        });
        expect(JSON.stringify(redirectedTimeline)).not.toContain(
          "https://www.tiktok.com/@cook/video/7520000000000001305"
        );

        const history = yield* Effect.promise(
          () =>
            testEnv.MealPlannerDatabase.prepare(
              `SELECT actor_category, actor_identity_hash, command_digest,
                    event_type, intent_version, mutation_id, occurred_at
               FROM recipe_import_intent_history
              WHERE intent_id = ? AND event_type = 'intent_cancelled'`
            )
              .bind(intentId)
              .all<{
                actor_category: string;
                actor_identity_hash: string | null;
                command_digest: string | null;
                event_type: string;
                intent_version: number;
                mutation_id: string | null;
                occurred_at: string;
              }>() as PromiseLike<{
              readonly results: readonly Record<string, unknown>[];
            }>
        );
        expect(history.results).toEqual([
          expect.objectContaining({
            actor_category: "household_member",
            actor_identity_hash: principal.actorId,
            event_type: "intent_cancelled",
            intent_version: 3,
            occurred_at: "2026-08-16T15:20:01.000Z",
          }),
        ]);
        expect(JSON.stringify(history.results)).not.toContain(
          "cancel-mutation-304"
        );
      })
    );
  });

  it("cancels requires-action without mutating the private review ledger", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const intentId = decodeIntentId("00000000-0000-4000-8000-000000000307");
    const actionId = decodeActionId("f".repeat(64));
    const idLayer = Layer.succeed(
      ImportIntentIdGenerator,
      ImportIntentIdGenerator.of({ next: Effect.succeed(intentId) })
    );
    const terminated: string[] = [];
    const terminatorLayer = Layer.succeed(
      ImportIntentWorkflowTerminator,
      ImportIntentWorkflowTerminator.of({
        terminate: (id) =>
          Effect.sync(() => {
            terminated.push(id);
          }),
      })
    );
    const application = makeImportIntentApplication(
      repository,
      workflowStarter,
      TestImportTrace
    );
    const transition = (ordinal: number, body: Record<string, unknown>) =>
      repository.transitionIntent(
        decodeTransition({
          ...body,
          commandDigest: (3000 + ordinal).toString(16).padStart(64, "0"),
          executionGeneration: 1,
          intentId,
          mutationId: (4000 + ordinal).toString(16).padStart(64, "0"),
          occurredAt: `2026-08-16T15:30:${ordinal
            .toString()
            .padStart(2, "0")}.000Z`,
        })
      );

    await Effect.runPromise(
      Effect.gen(function* requiresActionCancellationTracer() {
        yield* TestClock.setTime(Date.parse("2026-08-16T15:30:00.000Z"));
        yield* application.admit(
          principal,
          decodeRequest({
            source: {
              kind: "tiktok",
              url: "https://www.tiktok.com/t/ZCANCELREVIEW307",
            },
          }),
          decodeKey("cancel-review-admit-307")
        );
        yield* application.resolveSource(principal, {
          canonicalSourceId: decodeCanonicalSourceId("7520000000000001307"),
          canonicalUrl: decodeCanonicalUrl(
            "https://www.tiktok.com/@cook/video/7520000000000001307"
          ),
          intentId,
          sourceKind: "video",
        });
        yield* transition(1, {
          _tag: "AdvanceStage",
          stage: "analyzing_evidence",
        });
        yield* transition(2, {
          _tag: "AdvanceComponent",
          component: "speech",
          progress: "processing",
        });
        yield* transition(3, {
          _tag: "AdvanceComponent",
          component: "speech",
          progress: "completed",
        });
        yield* transition(4, {
          _tag: "AdvanceComponent",
          component: "visuals",
          progress: "processing",
        });
        yield* transition(5, {
          _tag: "AdvanceComponent",
          component: "visuals",
          progress: "completed",
        });
        yield* transition(6, {
          _tag: "AdvanceStage",
          stage: "extracting_recipe",
        });
        yield* transition(7, {
          _tag: "AdvanceStage",
          stage: "grounding_recipe",
        });
        yield* transition(8, {
          _tag: "AdvanceStage",
          stage: "preparing_review",
        });
        yield* transition(9, { _tag: "RequireAction", actionId });

        const fingerprint = "d".repeat(64);
        yield* Effect.promise(() =>
          testEnv.MealPlannerDatabase.prepare(
            `INSERT INTO import_recipe_extractions (
               extraction_fingerprint, import_id, acquisition_generation,
               evidence_fingerprint, extractor_provider, extractor_model,
               extractor_version, state, draft_json, input_evidence_items,
               input_tokens, output_tokens, model_calls, latency_milliseconds,
               estimated_cost_micro_usd, cost_currency, cost_certainty,
               is_current, created_at, updated_at, completed_at
             ) VALUES (?, ?, 0, ?, 'test', 'test', 'test', 'needs_review', '{}',
                       1, 1, 1, 1, 1, 1, 'USD', 'known', 1, ?, ?, ?)`
          )
            .bind(
              fingerprint,
              intentId,
              "e".repeat(64),
              "2026-08-16T15:30:09.000Z",
              "2026-08-16T15:30:09.000Z",
              "2026-08-16T15:30:09.000Z"
            )
            .run()
        );
        yield* Effect.promise(() =>
          testEnv.MealPlannerDatabase.prepare(
            `INSERT INTO recipe_reviews (
               extraction_fingerprint, lifecycle, version, tags_json,
               created_at, updated_at
             ) VALUES (?, 'needs_review', 1, NULL, ?, ?)`
          )
            .bind(
              fingerprint,
              "2026-08-16T15:30:09.000Z",
              "2026-08-16T15:30:09.000Z"
            )
            .run()
        );
        const reviewBefore = yield* Effect.promise(() =>
          testEnv.MealPlannerDatabase.prepare(
            `SELECT review.lifecycle, review.version,
                    (SELECT count(*) FROM recipe_review_mutations
                      WHERE extraction_fingerprint = review.extraction_fingerprint)
                      AS mutation_count
               FROM recipe_reviews AS review
              WHERE review.extraction_fingerprint = ?`
          )
            .bind(fingerprint)
            .first()
        );

        yield* TestClock.setTime(Date.parse("2026-08-16T15:31:00.000Z"));
        const cancelled = yield* application.cancel(
          principal,
          intentId,
          decodeCancelRequest({ expectedIntentVersion: 11 }),
          decodeKey("cancel-review-307")
        );
        expect(cancelled).toMatchObject({
          intentVersion: 12,
          status: "cancelled",
        });
        expect(terminated).toEqual([intentId]);
        const reviewAfter = yield* Effect.promise(() =>
          testEnv.MealPlannerDatabase.prepare(
            `SELECT review.lifecycle, review.version,
                    (SELECT count(*) FROM recipe_review_mutations
                      WHERE extraction_fingerprint = review.extraction_fingerprint)
                      AS mutation_count
               FROM recipe_reviews AS review
              WHERE review.extraction_fingerprint = ?`
          )
            .bind(fingerprint)
            .first()
        );
        expect(reviewAfter).toEqual(reviewBefore);
        expect(reviewAfter).toEqual({
          lifecycle: "needs_review",
          mutation_count: 0,
          version: 1,
        });
        const timeline = encodeTimeline(
          yield* application.timeline(principal, intentId)
        );
        expect(timeline.data.slice(-2)).toMatchObject([
          {
            action: { id: actionId, type: "review_recipe" },
            intentVersion: 11,
            type: "action_available",
          },
          {
            intentVersion: 12,
            type: "intent_cancelled",
          },
        ]);
        expect(JSON.stringify(timeline)).not.toContain(fingerprint);
      }).pipe(Effect.provide([idLayer, terminatorLayer, TestClock.layer()]))
    );
  });
});
