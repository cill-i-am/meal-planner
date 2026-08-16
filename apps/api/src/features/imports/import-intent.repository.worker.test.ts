import {
  CanonicalTikTokUrl,
  CancelRecipeImportIntentRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  Instant,
  RecipeImportActionId,
  RecipeImportIntentId,
  RecipeId,
} from "@meal-planner/recipe-import-api";
import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ImportIntentWorkflowTerminator,
  runCurrentImportIntentExecution,
} from "./import-intent-execution.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import {
  ImportIntentIdGenerator,
  ImportPrincipal,
  ReconcileStalledImportIntentStartsRequest,
  makeImportIntentApplication,
} from "./import-intent.js";
import { SourceCanonicalId } from "./import.contracts.js";
import { workflowStartUnavailable } from "./import.errors.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import type { ImportWorkflowReconcilerShape } from "./import.workflow.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};
const d1Results = <A>(promise: PromiseLike<unknown>) =>
  promise as PromiseLike<{ readonly results: readonly A[] }>;

const decodeRequest = Schema.decodeUnknownSync(CreateRecipeImportIntentRequest);
const decodeCancelRequest = Schema.decodeUnknownSync(
  CancelRecipeImportIntentRequest
);
const decodeKey = Schema.decodeUnknownSync(IdempotencyKey);
const decodeInstant = Schema.decodeUnknownSync(Instant);
const decodeCanonicalUrl = Schema.decodeUnknownSync(CanonicalTikTokUrl);
const decodeIntentId = Schema.decodeUnknownSync(RecipeImportIntentId);
const decodeActionId = Schema.decodeUnknownSync(RecipeImportActionId);
const decodeRecipeId = Schema.decodeUnknownSync(RecipeId);
const decodeCanonicalSourceId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodePrincipal = Schema.decodeUnknownSync(ImportPrincipal);
const decodeExecutionGeneration = Schema.decodeUnknownSync(
  ImportIntentExecutionGeneration
);
const decodeReconciliationRequest = Schema.decodeUnknownSync(
  ReconcileStalledImportIntentStartsRequest
);
const importWorkflowInstanceId = (importId: string) =>
  `import-acquisition-${importId}`;
const householdA = decodePrincipal({
  actorId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  householdScopeId:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});
const householdB = decodePrincipal({
  actorId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  householdScopeId:
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
});

const requestFor = (ordinal: number) =>
  decodeRequest({
    source: {
      kind: "tiktok",
      url: `https://www.tiktok.com/t/ZTEST${ordinal}?share_app_id=1233`,
    },
  });
const canonicalUrlFor = (ordinal: number) =>
  decodeCanonicalUrl(
    `https://www.tiktok.com/@cook/video/${7_520_000_000_000_000_000n + BigInt(ordinal)}`
  );
const canonicalSourceIdFor = (ordinal: number) =>
  decodeCanonicalSourceId(`${7_520_000_000_000_000_000n + BigInt(ordinal)}`);

const transitionPredecessorToTerminal = (
  status: "cancelled" | "failed",
  intentId: string
) =>
  Effect.promise(() =>
    status === "failed"
      ? testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_imports
              SET public_status = 'failed', public_stage = NULL,
                  public_stage_started_at = NULL, public_activity = NULL,
                  public_failure_code = 'analysis_failed',
                  public_failure_message = 'The source could not be analyzed.',
                  public_recovery = 'create_new_intent', failed_at = ?,
                  intent_version = intent_version + 1, updated_at = ?
            WHERE id = ?`
        )
          .bind(
            "2026-08-16T11:02:00.000Z",
            "2026-08-16T11:02:00.000Z",
            intentId
          )
          .run()
      : testEnv.MealPlannerDatabase.prepare(
          `UPDATE recipe_imports
              SET public_status = 'cancelled', public_stage = NULL,
                  public_stage_started_at = NULL, public_activity = NULL,
                  cancelled_at = ?, intent_version = intent_version + 1,
                  updated_at = ?
            WHERE id = ?`
        )
          .bind(
            "2026-08-16T11:02:00.000Z",
            "2026-08-16T11:02:00.000Z",
            intentId
          )
          .run()
  );

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("canonical recipe import intent repository in workerd", () => {
  it("admits, scopes, resolves, redirects, and converges atomically", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const activeInstanceIds = new Set<string>();
    const workflowStarts: {
      readonly correlationId: string;
      readonly executionGeneration: number;
      readonly importId: string;
      readonly instanceId: string;
    }[] = [];
    const workflowStarter: Pick<
      ImportWorkflowReconcilerShape,
      "ensureStarted"
    > = {
      ensureStarted: (importId, executionGeneration, trace) =>
        Effect.gen(function* recordDurableStart() {
          const committed = yield* Effect.promise<{
            execution_generation: number;
            history_count: number;
            intent_version: number;
            public_stage: string;
            public_status: string;
          } | null>(() =>
            testEnv.MealPlannerDatabase.prepare(
              `SELECT execution_generation, intent_version,
                      public_stage, public_status,
                      (SELECT count(*)
                         FROM recipe_import_intent_history h
                        WHERE h.intent_id = recipe_imports.id
                          AND h.event_type = 'source_resolved') AS history_count
                 FROM recipe_imports WHERE id = ?`
            )
              .bind(importId)
              .first()
          );
          expect(committed).toMatchObject({
            execution_generation: executionGeneration,
            history_count: 1,
            intent_version: 2,
            public_stage: "acquiring_media",
            public_status: "processing",
          });
          const instanceId = importWorkflowInstanceId(importId);
          workflowStarts.push({
            correlationId: trace.correlationId,
            executionGeneration,
            importId,
            instanceId,
          });
          if (activeInstanceIds.has(instanceId)) {
            return "already_active" as const;
          }
          activeInstanceIds.add(instanceId);
          return "created" as const;
        }),
    };
    const application = makeImportIntentApplication(
      repository,
      workflowStarter
    );
    let nextId = 1;
    const idLayer = Layer.succeed(
      ImportIntentIdGenerator,
      ImportIntentIdGenerator.of({
        next: Effect.sync(() => {
          const currentId = nextId;
          nextId += 1;
          return decodeIntentId(
            `00000000-0000-4000-8000-${currentId.toString().padStart(12, "0")}`
          );
        }),
      })
    );
    const run = <A, E>(effect: Effect.Effect<A, E, ImportIntentIdGenerator>) =>
      Effect.runPromise(
        effect.pipe(Effect.provide([idLayer, TestClock.layer()]))
      );

    await run(
      Effect.gen(function* repositoryTracer() {
        yield* TestClock.setTime(Date.parse("2026-08-16T11:00:00.000Z"));

        const admitted = yield* application.admit(
          householdA,
          requestFor(1),
          decodeKey("admission-key")
        );
        expect(admitted.intent).toMatchObject({
          intentVersion: 1,
          processing: { type: "resolving_source" },
          source: { resolution: "pending" },
          status: "processing",
        });
        const admissionRows = yield* Effect.promise(() =>
          d1Results<{
            actor_category: string;
            actor_identity_hash: string | null;
            command_digest: string | null;
            event_type: string;
            from_public_stage: string | null;
            from_public_status: string | null;
            intent_version: number;
            mutation_id: string | null;
            public_source_url: string | null;
            request_fingerprint: string;
            idempotency_key_hash: string;
            to_public_stage: string | null;
            to_public_status: string;
          }>(
            testEnv.MealPlannerDatabase.prepare(
              `SELECT h.actor_category, h.actor_identity_hash,
                      h.command_digest, h.event_type,
                      h.from_public_stage, h.from_public_status,
                      h.intent_version, h.mutation_id, h.public_source_url,
                      h.to_public_stage, h.to_public_status,
                      r.idempotency_key_hash, r.request_fingerprint
                 FROM recipe_import_intent_history h
                 JOIN import_requests r ON r.import_id = h.intent_id
                WHERE h.intent_id = ?`
            )
              .bind(admitted.intent.id)
              .all()
          )
        );
        expect(admissionRows.results).toEqual([
          expect.objectContaining({
            actor_category: "household_member",
            actor_identity_hash: householdA.actorId,
            command_digest: admissionRows.results[0]?.request_fingerprint,
            event_type: "intent_admitted",
            from_public_stage: null,
            from_public_status: null,
            intent_version: 1,
            mutation_id: admissionRows.results[0]?.idempotency_key_hash,
            public_source_url: null,
            to_public_stage: "resolving_source",
            to_public_status: "processing",
          }),
        ]);

        const replay = yield* application.admit(
          householdA,
          requestFor(1),
          decodeKey("admission-key")
        );
        expect(replay).toEqual({
          disposition: "idempotency_replay",
          intent: admitted.intent,
        });

        const conflict = yield* Effect.exit(
          application.admit(
            householdA,
            requestFor(2),
            decodeKey("admission-key")
          )
        );
        expect(Exit.isFailure(conflict)).toBe(true);
        if (Exit.isFailure(conflict)) {
          const error = Option.getOrThrow(
            Cause.findErrorOption(conflict.cause)
          );
          expect(error).toMatchObject({
            _tag: "RecipeImportIntentIdempotencyConflict",
          });
          expect(JSON.stringify(error)).not.toContain("tiktok.com");
        }

        const concurrentReplays = yield* Effect.all(
          [
            application.admit(
              householdA,
              requestFor(40),
              decodeKey("concurrent-replay-key")
            ),
            application.admit(
              householdA,
              requestFor(40),
              decodeKey("concurrent-replay-key")
            ),
          ],
          { concurrency: "unbounded" }
        );
        expect(
          concurrentReplays.map(({ disposition }) => disposition).toSorted()
        ).toEqual(["created", "idempotency_replay"]);
        expect(concurrentReplays[0]?.intent.id).toBe(
          concurrentReplays[1]?.intent.id
        );
        const concurrentReplayId = concurrentReplays[0]?.intent.id;
        expect(concurrentReplayId).toBeDefined();
        const concurrentReplayCounts = yield* Effect.promise(() =>
          testEnv.MealPlannerDatabase.prepare(
            `SELECT
               (SELECT count(*) FROM recipe_imports WHERE id = ?) AS intents,
               (SELECT count(*) FROM import_requests WHERE import_id = ?) AS requests,
               (SELECT count(*) FROM recipe_import_intent_history
                 WHERE intent_id = ? AND event_type = 'intent_admitted') AS history`
          )
            .bind(concurrentReplayId, concurrentReplayId, concurrentReplayId)
            .first<{ history: number; intents: number; requests: number }>()
        );
        expect(concurrentReplayCounts).toEqual({
          history: 1,
          intents: 1,
          requests: 1,
        });

        const concurrentConflict = yield* Effect.all(
          [
            Effect.exit(
              application.admit(
                householdA,
                requestFor(41),
                decodeKey("concurrent-conflict-key")
              )
            ),
            Effect.exit(
              application.admit(
                householdA,
                requestFor(42),
                decodeKey("concurrent-conflict-key")
              )
            ),
          ],
          { concurrency: "unbounded" }
        );
        const concurrentWinners = concurrentConflict.filter(Exit.isSuccess);
        const concurrentLosers = concurrentConflict.filter(Exit.isFailure);
        expect(concurrentWinners).toHaveLength(1);
        expect(concurrentLosers).toHaveLength(1);
        const [concurrentWinner] = concurrentWinners;
        const [concurrentLoser] = concurrentLosers;
        if (
          concurrentWinner === undefined ||
          concurrentLoser === undefined ||
          Exit.isFailure(concurrentWinner) ||
          Exit.isSuccess(concurrentLoser)
        ) {
          return yield* Effect.die("Expected one concurrent admission winner");
        }
        expect(
          Option.getOrThrow(Cause.findErrorOption(concurrentLoser.cause))
        ).toMatchObject({
          _tag: "RecipeImportIntentIdempotencyConflict",
        });
        const concurrentConflictCounts = yield* Effect.promise(() =>
          testEnv.MealPlannerDatabase.prepare(
            `SELECT
               count(DISTINCT i.id) AS intents,
               count(DISTINCT r.import_id) AS requests,
               count(DISTINCT h.intent_id) AS history
              FROM recipe_imports i
              LEFT JOIN import_requests r ON r.import_id = i.id
              LEFT JOIN recipe_import_intent_history h
                ON h.intent_id = i.id AND h.event_type = 'intent_admitted'
             WHERE i.household_scope_id = ?
               AND i.submitted_source_url IN (?, ?)`
          )
            .bind(
              householdA.householdScopeId,
              requestFor(41).source.url,
              requestFor(42).source.url
            )
            .first<{ history: number; intents: number; requests: number }>()
        );
        expect(concurrentConflictCounts).toEqual({
          history: 1,
          intents: 1,
          requests: 1,
        });

        const hidden = yield* Effect.exit(
          application.get(householdB, admitted.intent.id)
        );
        expect(Exit.isFailure(hidden)).toBe(true);
        if (Exit.isFailure(hidden)) {
          expect(
            Option.getOrThrow(Cause.findErrorOption(hidden.cause))
          ).toMatchObject({
            _tag: "RecipeImportIntentNotFound",
          });
        }

        yield* TestClock.adjust(1000);
        const claimed = yield* application.resolveSource(householdA, {
          canonicalSourceId: canonicalSourceIdFor(1),
          canonicalUrl: canonicalUrlFor(1),
          intentId: admitted.intent.id,
          sourceKind: "video",
        });
        expect(claimed).toMatchObject({
          intentVersion: 2,
          processing: { sourceKind: "video", type: "acquiring_media" },
          source: { resolution: "resolved" },
          status: "processing",
        });
        const claimSnapshot = yield* Effect.promise<{
          execution_generation: number;
          intent_version: number;
          public_stage_started_at: string;
          updated_at: string;
        } | null>(() =>
          testEnv.MealPlannerDatabase.prepare(
            `SELECT execution_generation, intent_version,
                    public_stage_started_at, updated_at
               FROM recipe_imports WHERE id = ?`
          )
            .bind(admitted.intent.id)
            .first()
        );
        expect(claimSnapshot?.execution_generation).toBe(1);
        expect(workflowStarts).toEqual([
          {
            correlationId: expect.any(String),
            executionGeneration: 1,
            importId: admitted.intent.id,
            instanceId: importWorkflowInstanceId(admitted.intent.id),
          },
        ]);
        const claimReplay = yield* application.resolveSource(householdA, {
          canonicalSourceId: canonicalSourceIdFor(1),
          canonicalUrl: canonicalUrlFor(1),
          intentId: admitted.intent.id,
          sourceKind: "video",
        });
        expect(claimReplay).toEqual(claimed);
        expect(workflowStarts.slice(0, 2)).toEqual([
          workflowStarts[0],
          workflowStarts[0],
        ]);
        expect(activeInstanceIds).toEqual(
          new Set([importWorkflowInstanceId(admitted.intent.id)])
        );
        expect(
          yield* Effect.promise(() =>
            testEnv.MealPlannerDatabase.prepare(
              `SELECT execution_generation, intent_version,
                      public_stage_started_at, updated_at
                 FROM recipe_imports WHERE id = ?`
            )
              .bind(admitted.intent.id)
              .first()
          )
        ).toEqual(claimSnapshot);
        expect(
          (yield* Effect.promise(() =>
            d1Results<{
              actor_category: string;
              actor_identity_hash: string | null;
              command_digest: string | null;
              event_type: string;
              from_public_stage: string | null;
              from_public_status: string | null;
              intent_version: number;
              mutation_id: string | null;
              to_public_stage: string | null;
              to_public_status: string;
            }>(
              testEnv.MealPlannerDatabase.prepare(
                `SELECT actor_category, actor_identity_hash, command_digest,
                        event_type, from_public_stage, from_public_status,
                        intent_version, mutation_id, to_public_stage,
                        to_public_status
                   FROM recipe_import_intent_history WHERE intent_id = ?
                   ORDER BY intent_version`
              )
                .bind(admitted.intent.id)
                .all()
            )
          )).results
        ).toEqual([
          expect.objectContaining({
            actor_category: "household_member",
            actor_identity_hash: householdA.actorId,
            event_type: "intent_admitted",
            from_public_stage: null,
            from_public_status: null,
            intent_version: 1,
            to_public_stage: "resolving_source",
            to_public_status: "processing",
          }),
          {
            actor_category: "system",
            actor_identity_hash: null,
            command_digest: expect.stringMatching(/^[a-f\d]{64}$/u),
            event_type: "source_resolved",
            from_public_stage: "resolving_source",
            from_public_status: "processing",
            intent_version: 2,
            mutation_id: expect.stringMatching(/^[a-f\d]{64}$/u),
            to_public_stage: "acquiring_media",
            to_public_status: "processing",
          },
        ]);

        const conflictingResolution = yield* Effect.exit(
          application.resolveSource(householdA, {
            canonicalSourceId: canonicalSourceIdFor(2),
            canonicalUrl: canonicalUrlFor(2),
            intentId: admitted.intent.id,
            sourceKind: "carousel",
          })
        );
        expect(Exit.isFailure(conflictingResolution)).toBe(true);
        if (Exit.isFailure(conflictingResolution)) {
          expect(
            Option.getOrThrow(
              Cause.findErrorOption(conflictingResolution.cause)
            )
          ).toMatchObject({
            _tag: "ImportIntentTransitionMutationConflict",
          });
        }

        for (const hiddenMutation of [
          application.resolveSource(householdB, {
            canonicalSourceId: canonicalSourceIdFor(1),
            canonicalUrl: canonicalUrlFor(1),
            intentId: admitted.intent.id,
            sourceKind: "video" as const,
          }),
          application.requireMutable(householdB, admitted.intent.id),
        ]) {
          const hiddenExit = yield* Effect.exit(hiddenMutation);
          expect(Exit.isFailure(hiddenExit)).toBe(true);
          if (Exit.isFailure(hiddenExit)) {
            expect(
              Option.getOrThrow(Cause.findErrorOption(hiddenExit.cause))
            ).toMatchObject({ _tag: "RecipeImportIntentNotFound" });
          }
        }

        const startsBeforeRedirect = workflowStarts.length;
        const duplicate = yield* application.admit(
          householdA,
          requestFor(1),
          decodeKey("duplicate-key")
        );
        const redirected = yield* application.resolveSource(householdA, {
          canonicalSourceId: canonicalSourceIdFor(1),
          canonicalUrl: canonicalUrlFor(1),
          intentId: duplicate.intent.id,
          sourceKind: "video",
        });
        expect(redirected).toMatchObject({
          redirect: { intentId: admitted.intent.id },
          status: "redirected",
        });
        expect(redirected).not.toHaveProperty("action");
        expect(redirected).not.toHaveProperty("result");
        const redirectReplay = yield* application.resolveSource(householdA, {
          canonicalSourceId: canonicalSourceIdFor(1),
          canonicalUrl: canonicalUrlFor(1),
          intentId: duplicate.intent.id,
          sourceKind: "video",
        });
        expect(redirectReplay).toEqual(redirected);
        expect(workflowStarts).toHaveLength(startsBeforeRedirect);
        expect(
          (yield* Effect.promise(() =>
            d1Results<{
              actor_category: string;
              actor_identity_hash: string | null;
              command_digest: string | null;
              event_type: string;
              from_public_stage: string | null;
              from_public_status: string | null;
              intent_version: number;
              mutation_id: string | null;
              to_public_stage: string | null;
              to_public_status: string;
            }>(
              testEnv.MealPlannerDatabase.prepare(
                `SELECT actor_category, actor_identity_hash, command_digest,
                        event_type, from_public_stage, from_public_status,
                        intent_version, mutation_id, to_public_stage,
                        to_public_status
                   FROM recipe_import_intent_history WHERE intent_id = ?
                   ORDER BY intent_version`
              )
                .bind(duplicate.intent.id)
                .all()
            )
          )).results
        ).toEqual([
          expect.objectContaining({
            actor_category: "household_member",
            actor_identity_hash: householdA.actorId,
            event_type: "intent_admitted",
            from_public_stage: null,
            from_public_status: null,
            intent_version: 1,
            to_public_stage: "resolving_source",
            to_public_status: "processing",
          }),
          {
            actor_category: "system",
            actor_identity_hash: null,
            command_digest: expect.stringMatching(/^[a-f\d]{64}$/u),
            event_type: "intent_redirected",
            from_public_stage: "resolving_source",
            from_public_status: "processing",
            intent_version: 2,
            mutation_id: expect.stringMatching(/^[a-f\d]{64}$/u),
            to_public_stage: null,
            to_public_status: "redirected",
          },
        ]);

        const redirectedMutation = yield* Effect.exit(
          application.requireMutable(householdA, duplicate.intent.id)
        );
        expect(Exit.isFailure(redirectedMutation)).toBe(true);
        if (Exit.isFailure(redirectedMutation)) {
          const error = Option.getOrThrow(
            Cause.findErrorOption(redirectedMutation.cause)
          );
          expect(error).toMatchObject({
            _tag: "RecipeImportIntentRedirected",
            intent: { id: duplicate.intent.id, status: "redirected" },
            redirect: { intentId: admitted.intent.id },
          });
          expect(JSON.stringify(error)).not.toContain(requestFor(1).source.url);
        }

        const crossHousehold = yield* application.admit(
          householdB,
          requestFor(1),
          decodeKey("admission-key")
        );
        const crossHouseholdClaim = yield* application.resolveSource(
          householdB,
          {
            canonicalSourceId: canonicalSourceIdFor(1),
            canonicalUrl: canonicalUrlFor(1),
            intentId: crossHousehold.intent.id,
            sourceKind: "video",
          }
        );
        expect(crossHouseholdClaim.status).toBe("processing");
        expect(crossHouseholdClaim.id).not.toBe(admitted.intent.id);

        for (const [status, ordinal] of [
          ["requires_action", 10],
          ["succeeded", 11],
        ] as const) {
          const winner = yield* application.admit(
            householdA,
            requestFor(ordinal),
            decodeKey(`winner-${status}`)
          );
          yield* application.resolveSource(householdA, {
            canonicalSourceId: canonicalSourceIdFor(ordinal),
            canonicalUrl: canonicalUrlFor(ordinal),
            intentId: winner.intent.id,
            sourceKind: "video",
          });
          if (status === "requires_action") {
            const actionId = decodeActionId(
              ordinal.toString(16).padStart(64, "0")
            );
            yield* Effect.promise(() =>
              testEnv.MealPlannerDatabase.prepare(
                `UPDATE recipe_imports
                    SET public_status = 'requires_action', public_stage = NULL,
                        public_stage_started_at = NULL, public_activity = NULL,
                        active_action_id = ?, active_action_version = 1,
                        intent_version = intent_version + 1,
                        updated_at = ?
                  WHERE id = ?`
              )
                .bind(actionId, "2026-08-16T11:01:00.000Z", winner.intent.id)
                .run()
            );
          } else {
            const recipeId = decodeRecipeId(
              `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`
            );
            yield* Effect.promise(() =>
              testEnv.MealPlannerDatabase.prepare(
                `UPDATE recipe_imports
                    SET public_status = 'succeeded', public_stage = NULL,
                        public_stage_started_at = NULL, public_activity = NULL,
                        public_recipe_id = ?, succeeded_at = ?,
                        intent_version = intent_version + 1, updated_at = ?
                  WHERE id = ?`
              )
                .bind(
                  recipeId,
                  "2026-08-16T11:01:00.000Z",
                  "2026-08-16T11:01:00.000Z",
                  winner.intent.id
                )
                .run()
            );
          }
          const provisional = yield* application.admit(
            householdA,
            requestFor(ordinal),
            decodeKey(`provisional-${status}`)
          );
          const outcome = yield* application.resolveSource(householdA, {
            canonicalSourceId: canonicalSourceIdFor(ordinal),
            canonicalUrl: canonicalUrlFor(ordinal),
            intentId: provisional.intent.id,
            sourceKind: "video",
          });
          expect(outcome).toMatchObject({
            redirect: { intentId: winner.intent.id },
            status: "redirected",
          });
        }

        for (const [status, ordinal] of [
          ["failed", 20],
          ["cancelled", 21],
        ] as const) {
          const predecessor = yield* application.admit(
            householdA,
            requestFor(ordinal),
            decodeKey(`predecessor-${status}`)
          );
          yield* application.resolveSource(householdA, {
            canonicalSourceId: canonicalSourceIdFor(ordinal),
            canonicalUrl: canonicalUrlFor(ordinal),
            intentId: predecessor.intent.id,
            sourceKind: "video",
          });
          yield* transitionPredecessorToTerminal(status, predecessor.intent.id);
          const fresh = yield* application.admit(
            householdA,
            requestFor(ordinal),
            decodeKey(`fresh-${status}`)
          );
          const freshClaim = yield* application.resolveSource(householdA, {
            canonicalSourceId: canonicalSourceIdFor(ordinal),
            canonicalUrl: canonicalUrlFor(ordinal),
            intentId: fresh.intent.id,
            sourceKind: "video",
          });
          expect(freshClaim).toMatchObject({
            id: fresh.intent.id,
            status: "processing",
          });
        }

        const racers = yield* Effect.all([
          application.admit(householdA, requestFor(30), decodeKey("race-one")),
          application.admit(householdA, requestFor(30), decodeKey("race-two")),
        ]);
        const raceResults = yield* Effect.all(
          racers.map((racer) =>
            application.resolveSource(householdA, {
              canonicalSourceId: canonicalSourceIdFor(30),
              canonicalUrl: canonicalUrlFor(30),
              intentId: racer.intent.id,
              sourceKind: "video",
            })
          ),
          { concurrency: "unbounded" }
        );
        expect(
          raceResults.filter((intent) => intent.status === "processing")
        ).toHaveLength(1);
        expect(
          raceResults.filter((intent) => intent.status === "redirected")
        ).toHaveLength(1);

        const liveRows = yield* Effect.promise(() =>
          d1Results<{ id: string; public_status: string }>(
            testEnv.MealPlannerDatabase.prepare(
              `SELECT id, public_status FROM recipe_imports
              WHERE household_scope_id = ? AND resolved_canonical_source_id = ?
                AND public_status IN ('processing', 'requires_action', 'succeeded')`
            )
              .bind(householdA.householdScopeId, "7520000000000000030")
              .all()
          )
        );
        expect(liveRows.results).toHaveLength(1);

        const foreignKeyViolations = yield* Effect.promise(() =>
          d1Results<unknown>(
            testEnv.MealPlannerDatabase.prepare(
              "PRAGMA foreign_key_check"
            ).all()
          )
        );
        expect(foreignKeyViolations.results).toEqual([]);
      })
    );
  });

  it("keeps the durable owner claim when Workflow start fails", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const intentId = decodeIntentId("00000000-0000-4000-8000-000000000099");
    const idLayer = Layer.succeed(
      ImportIntentIdGenerator,
      ImportIntentIdGenerator.of({ next: Effect.succeed(intentId) })
    );
    const application = makeImportIntentApplication(repository, {
      ensureStarted: () => Effect.fail(workflowStartUnavailable()),
    });

    await Effect.runPromise(
      Effect.gen(function* failedStartTracer() {
        yield* TestClock.setTime(Date.parse("2026-08-16T11:30:00.000Z"));
        const admitted = yield* application.admit(
          householdA,
          requestFor(99),
          decodeKey("start-failure-key")
        );
        const exit = yield* Effect.exit(
          application.resolveSource(householdA, {
            canonicalSourceId: canonicalSourceIdFor(99),
            canonicalUrl: canonicalUrlFor(99),
            intentId: admitted.intent.id,
            sourceKind: "video",
          })
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
            _tag: "WorkflowStartUnavailable",
          });
        }
        const committed = yield* Effect.promise<{
          execution_generation: number;
          history_count: number;
          intent_version: number;
          public_stage: string;
          public_status: string;
        } | null>(() =>
          testEnv.MealPlannerDatabase.prepare(
            `SELECT execution_generation, intent_version,
                    public_stage, public_status,
                    (SELECT count(*)
                       FROM recipe_import_intent_history h
                      WHERE h.intent_id = recipe_imports.id
                        AND h.event_type = 'source_resolved') AS history_count
               FROM recipe_imports WHERE id = ?`
          )
            .bind(intentId)
            .first()
        );
        expect(committed).toEqual({
          execution_generation: 1,
          history_count: 1,
          intent_version: 2,
          public_stage: "acquiring_media",
          public_status: "processing",
        });
      }).pipe(Effect.provide([idLayer, TestClock.layer()]))
    );
  });

  it("reconstructs and reconciles bounded stalled starts in deterministic order", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const intentIdForOrdinal = (ordinal: number) =>
      decodeIntentId(
        `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`
      );
    const skippedIntentId = intentIdForOrdinal(201);
    const failedIntentId = intentIdForOrdinal(202);
    const successfulIntentId = intentIdForOrdinal(204);
    const recentIntentId = intentIdForOrdinal(203);
    const intentIds = [
      skippedIntentId,
      failedIntentId,
      successfulIntentId,
      recentIntentId,
    ];
    let nextIntentIndex = 0;
    let reconciling = false;
    const activeInstanceIds = new Set<string>();
    const starts: {
      readonly executionGeneration: number;
      readonly importId: string;
      readonly correlationId: string;
    }[] = [];
    const workflowStarter: Pick<
      ImportWorkflowReconcilerShape,
      "ensureStarted"
    > = {
      ensureStarted: (importId, executionGeneration, trace) => {
        if (!reconciling) {
          return Effect.succeed("already_active" as const);
        }
        starts.push({
          correlationId: trace.correlationId,
          executionGeneration,
          importId,
        });
        if (String(importId) === failedIntentId) {
          return Effect.fail(workflowStartUnavailable());
        }
        const instanceId = importWorkflowInstanceId(importId);
        const created = !activeInstanceIds.has(instanceId);
        activeInstanceIds.add(instanceId);
        return Effect.succeed(
          created ? ("created" as const) : ("already_active" as const)
        );
      },
    };
    const repositoryWithRecheckSkip = {
      ...repository,
      isIntentExecutionCurrent: (
        intentId: Parameters<typeof repository.isIntentExecutionCurrent>[0],
        executionGeneration: Parameters<
          typeof repository.isIntentExecutionCurrent
        >[1]
      ) =>
        intentId === skippedIntentId
          ? Effect.succeed(false)
          : repository.isIntentExecutionCurrent(intentId, executionGeneration),
    };
    const application = makeImportIntentApplication(
      repositoryWithRecheckSkip,
      workflowStarter
    );
    const idLayer = Layer.succeed(
      ImportIntentIdGenerator,
      ImportIntentIdGenerator.of({
        next: Effect.sync(() => {
          const next = intentIds[nextIntentIndex];
          nextIntentIndex += 1;
          if (next === undefined) {
            throw new Error("stalled intent ID fixture exhausted");
          }
          return next;
        }),
      })
    );

    await Effect.runPromise(
      Effect.gen(function* stalledStartTracer() {
        yield* TestClock.setTime(Date.parse("2026-08-15T12:00:00.000Z"));
        for (const ordinal of [201, 202, 204]) {
          const admitted = yield* application.admit(
            householdA,
            requestFor(ordinal),
            decodeKey(`stalled-${ordinal}`)
          );
          yield* application.resolveSource(householdA, {
            canonicalSourceId: canonicalSourceIdFor(ordinal),
            canonicalUrl: canonicalUrlFor(ordinal),
            intentId: admitted.intent.id,
            sourceKind: "video",
          });
        }

        yield* TestClock.setTime(Date.parse("2026-08-15T12:09:00.000Z"));
        const recent = yield* application.admit(
          householdA,
          requestFor(203),
          decodeKey("recent-203")
        );
        yield* application.resolveSource(householdA, {
          canonicalSourceId: canonicalSourceIdFor(203),
          canonicalUrl: canonicalUrlFor(203),
          intentId: recent.intent.id,
          sourceKind: "video",
        });

        const reconstructedRepository = makeD1ImportRepository(
          testEnv.MealPlannerDatabase
        );
        const one = yield* reconstructedRepository.listStalledIntentStarts(
          decodeInstant("2026-08-15T12:05:00.000Z"),
          decodeReconciliationRequest({
            limit: 1,
            minimumAgeMilliseconds: 300_000,
          }).limit
        );
        expect(one.map(({ intentId }) => intentId)).toEqual([skippedIntentId]);

        const reconstructed =
          yield* reconstructedRepository.listStalledIntentStarts(
            decodeInstant("2026-08-15T12:05:00.000Z"),
            decodeReconciliationRequest({
              limit: 10,
              minimumAgeMilliseconds: 300_000,
            }).limit
          );
        expect(
          reconstructed.map(({ executionGeneration, intentId, updatedAt }) => ({
            executionGeneration,
            intentId,
            updatedAt,
          }))
        ).toEqual(
          [skippedIntentId, failedIntentId, successfulIntentId].map(
            (intentId) => ({
              executionGeneration: 1,
              intentId,
              updatedAt: decodeInstant("2026-08-15T12:00:00.000Z"),
            })
          )
        );

        reconciling = true;
        yield* TestClock.setTime(Date.parse("2026-08-15T12:10:00.000Z"));
        const request = decodeReconciliationRequest({
          limit: 10,
          minimumAgeMilliseconds: 300_000,
        });
        const first = yield* application.reconcileStalledStarts(request);
        const replay = yield* application.reconcileStalledStarts(request);
        expect(first).toEqual({
          ensured: 1,
          examined: 3,
          skipped: 1,
          startFailures: 1,
        });
        expect(replay).toEqual(first);
        expect(activeInstanceIds).toEqual(
          new Set([importWorkflowInstanceId(successfulIntentId)])
        );
        expect(starts).toHaveLength(4);
        expect(
          starts.map(({ executionGeneration, importId }) => ({
            executionGeneration,
            importId,
          }))
        ).toEqual([
          { executionGeneration: 1, importId: failedIntentId },
          { executionGeneration: 1, importId: successfulIntentId },
          { executionGeneration: 1, importId: failedIntentId },
          { executionGeneration: 1, importId: successfulIntentId },
        ]);
        expect(starts[1]?.correlationId).toBe(starts[3]?.correlationId);
      }).pipe(Effect.provide([idLayer, TestClock.layer()]))
    );
  });

  it("stops a just-created stale Workflow before provider work when cancellation wins the race", async () => {
    const repository = makeD1ImportRepository(testEnv.MealPlannerDatabase);
    const intentId = decodeIntentId("00000000-0000-4000-8000-000000000205");
    let reconciling = false;
    let startedWorkflows = 0;
    let providerCalls = 0;
    let terminationCalls = 0;
    let preflightResult: unknown;
    const applicationReference: {
      current?: ReturnType<typeof makeImportIntentApplication>;
    } = {};
    const terminator = ImportIntentWorkflowTerminator.of({
      terminate: () =>
        Effect.sync(() => {
          terminationCalls += 1;
        }),
    });
    const workflowStarter: Pick<
      ImportWorkflowReconcilerShape,
      "ensureStarted"
    > = {
      ensureStarted: (importId, executionGeneration) => {
        if (!reconciling) {
          return Effect.succeed("already_active" as const);
        }
        return Effect.gen(function* cancelBeforeCreate() {
          const application = applicationReference.current;
          if (application === undefined) {
            return yield* Effect.die("missing cancellation race application");
          }
          yield* application.cancel(
            householdA,
            intentId,
            decodeCancelRequest({ expectedIntentVersion: 2 }),
            decodeKey("cancel-before-stalled-create")
          );
          startedWorkflows += 1;
          preflightResult = yield* runCurrentImportIntentExecution(
            repository,
            intentId,
            executionGeneration,
            () =>
              Effect.sync(() => {
                providerCalls += 1;
                return "provider-ran" as const;
              })
          );
          expect(importId).toBe(intentId);
          return "created" as const;
        }).pipe(
          Effect.provideService(ImportIntentWorkflowTerminator, terminator),
          Effect.orDie
        );
      },
    };
    const application = makeImportIntentApplication(
      repository,
      workflowStarter
    );
    applicationReference.current = application;
    const idLayer = Layer.succeed(
      ImportIntentIdGenerator,
      ImportIntentIdGenerator.of({ next: Effect.succeed(intentId) })
    );

    await Effect.runPromise(
      Effect.gen(function* cancellationRaceTracer() {
        yield* TestClock.setTime(Date.parse("2026-08-14T13:00:00.000Z"));
        const admitted = yield* application.admit(
          householdA,
          requestFor(205),
          decodeKey("stalled-cancel-race")
        );
        yield* application.resolveSource(householdA, {
          canonicalSourceId: canonicalSourceIdFor(205),
          canonicalUrl: canonicalUrlFor(205),
          intentId: admitted.intent.id,
          sourceKind: "video",
        });

        yield* TestClock.setTime(Date.parse("2026-08-14T13:10:00.000Z"));
        reconciling = true;
        const summary = yield* application.reconcileStalledStarts(
          decodeReconciliationRequest({
            limit: 10,
            minimumAgeMilliseconds: 300_000,
          })
        );
        expect(summary).toEqual({
          ensured: 1,
          examined: 1,
          skipped: 0,
          startFailures: 0,
        });
        expect(startedWorkflows).toBe(1);
        expect(terminationCalls).toBe(1);
        expect(preflightResult).toEqual({
          _tag: "ImportIntentExecutionSuperseded",
        });
        expect(providerCalls).toBe(0);
        expect(
          yield* repository.isIntentExecutionCurrent(
            intentId,
            decodeExecutionGeneration(1)
          )
        ).toBe(false);

        const cancelled = yield* application.get(householdA, intentId);
        expect(cancelled.status).toBe("cancelled");
        expect(
          yield* application.reconcileStalledStarts(
            decodeReconciliationRequest({
              limit: 10,
              minimumAgeMilliseconds: 300_000,
            })
          )
        ).toEqual({
          ensured: 0,
          examined: 0,
          skipped: 0,
          startFailures: 0,
        });
      }).pipe(Effect.provide([idLayer, TestClock.layer()]))
    );
  });

  it("types malformed stalled-start rows as persistence corruption", async () => {
    const statement = {
      all: () =>
        Promise.resolve({
          results: [
            {
              executionGeneration: "not-a-generation",
              intentId: "00000000-0000-4000-8000-000000000299",
              updatedAt: "2026-08-16T13:00:00.000Z",
            },
          ],
        }),
      bind: () => statement,
    };
    const corruptRepository = makeD1ImportRepository({
      prepare: () => statement,
    } as unknown as AnyD1Database);
    const exit = await Effect.runPromise(
      Effect.exit(
        corruptRepository.listStalledIntentStarts(
          decodeInstant("2026-08-16T14:00:00.000Z"),
          decodeReconciliationRequest({
            limit: 1,
            minimumAgeMilliseconds: 300_000,
          }).limit
        )
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
        _tag: "ImportPersistenceCorrupt",
      });
    }
  });
});
