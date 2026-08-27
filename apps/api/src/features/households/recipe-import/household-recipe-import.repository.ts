import { MealPlanRecipeSnapshot } from "@meal-planner/household-api";
import {
  ActiveRecipeImportAction,
  CancelledRecipeImportIntent,
  CompletedRecipeImportAction,
  FailedRecipeImportIntent,
  ProcessingActivity,
  ProcessingRecipeImportIntent,
  Recipe,
  RecipeImportAction,
  RecipeImportIntentId,
  RecipeImportIntent,
  RecipeImportTimelineEvent,
  RecipeReviewActionView,
  RedirectedRecipeImportIntent,
  RequiresActionRecipeImportIntent,
  ResolvedProcessingStage,
  SucceededRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Clock, Effect, Option, Schema } from "effect";

import { ImportIntentExecutionGeneration } from "../../imports/import-intent-transition.js";
import { ImportTraceContext } from "../../imports/import-observability.js";
import { ImportId } from "../../imports/import.contracts.js";
import { ensureHouseholdProvenance } from "../foundation/household-provenance.js";
import {
  HouseholdDispatchId,
  HouseholdImportWorkflowAdmissionResult,
} from "../foundation/import-workflow-admission.contract.js";
import {
  householdImportWorkflowAdmissions,
  householdImportEvidenceExecutions,
  householdLiveRecipeImportStatuses,
  householdOutbox,
  householdRecipeImportMutationReceipts,
  householdRecipeImportRequests,
  householdRecipeImports,
  householdRecipeImportTimeline,
  householdRecipeReviewCorrections,
  householdRecipeReviewTransitions,
  householdRecipes,
} from "../household.database-schema.js";
import {
  HouseholdCanonicalEncoding,
  HouseholdDigest,
  HouseholdIdentityGenerator,
} from "../shared-kernel/authority-services.js";
import { makeImportWorkflowIdentity } from "../shared-kernel/workflow-identity.js";
import {
  HouseholdRecipeImportFailure,
  HouseholdRecipeImportExecutionView,
  HouseholdRecipePageCursor,
  householdRecipeMaximumEncodedBytes,
} from "./household-recipe-import.contract.js";
import type {
  HouseholdAdmitRecipeImportInput,
  HouseholdAnswerRecipeImportActionInput,
  HouseholdCancelRecipeImportInput,
  HouseholdCommitRecipeImportDraftInput,
  HouseholdConfirmRecipeImportActionInput,
  HouseholdReadRecipeImportActionInput,
  HouseholdReadRecipeImportExecutionInput,
  HouseholdReadRecipeImportInput,
  HouseholdReadRecipeInput,
  HouseholdRecipePageInput,
  HouseholdResolveRecipeImportSourceInput,
  HouseholdTransitionRecipeImportLifecycleInput,
} from "./household-recipe-import.contract.js";

const failure = (reason: HouseholdRecipeImportFailure["reason"]) =>
  HouseholdRecipeImportFailure.make({ reason });
const persistenceFailure = () => failure("persistence_unavailable");
const normalizePersistenceFailure = <E>(error: E) =>
  Schema.is(HouseholdRecipeImportFailure)(error) ? error : persistenceFailure();
const mapPersistence = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(persistenceFailure));
const mapTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(normalizePersistenceFailure));

const EncodedIntent = Schema.fromJsonString(RecipeImportIntent);
const EncodedAction = Schema.fromJsonString(RecipeImportAction);
const EncodedReview = Schema.fromJsonString(
  Schema.Struct({
    evidenceFingerprint: Schema.String,
    extractionFingerprint: Schema.String,
    review: RecipeReviewActionView,
  })
);
const EncodedRecipe = Schema.fromJsonString(Recipe);
const EncodedPlanningRecipe = Schema.fromJsonString(MealPlanRecipeSnapshot);
const EncodedTimelineEvent = Schema.fromJsonString(RecipeImportTimelineEvent);
const EncodedAdmission = Schema.fromJsonString(
  HouseholdImportWorkflowAdmissionResult
);

const encode = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  Schema.encodeEffect(schema)(value).pipe(Effect.mapError(persistenceFailure));
const decode = <S extends Schema.Top>(schema: S, value: Schema.Json) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(persistenceFailure)
  );
const encodeTimelineEvent = (value: Schema.Json) =>
  decode(RecipeImportTimelineEvent, value).pipe(
    Effect.flatMap((event) => encode(EncodedTimelineEvent, event))
  );

const instantFromEpoch = (epochMs: number) => new Date(epochMs).toISOString();

const linksFor = (intentId: string) => ({
  self: `/v1/recipe-import-intents/${intentId}`,
  timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
});

const actionLink = (intentId: string, actionId: string) =>
  `/v1/recipe-import-intents/${intentId}/actions/${actionId}`;

const stageOrdinal = (stage: string) =>
  [
    "resolving_source",
    "acquiring_media",
    "analyzing_evidence",
    "extracting_recipe",
    "grounding_recipe",
    "preparing_review",
    "finalizing_recipe",
  ].indexOf(stage);

const answerProperty = {
  author: "author",
  category: "category",
  cook_time_minutes: "cookTimeMinutes",
  cuisine: "cuisine",
  description: "description",
  ingredient_lines: "ingredientLines",
  ingredient_quantities: "ingredientQuantities",
  ingredient_units: "ingredientUnits",
  instructions: "instructions",
  name: "name",
  nutrition: "nutrition",
  prep_time_minutes: "prepTimeMinutes",
  temperature_celsius: "temperatureCelsius",
  tools: "tools",
  total_time_minutes: "totalTimeMinutes",
  yield: "yield",
} as const;

const applyAnswers = (
  current: typeof RecipeReviewActionView.Type,
  answers: HouseholdAnswerRecipeImportActionInput["request"]["answers"]
) => {
  const recipe = { ...current.recipe };
  let { tags } = current;
  const answerMap = new Map(
    current.answers.map((answer) => [answer.field, answer])
  );
  for (const answer of answers) {
    answerMap.set(answer.field, answer);
    if (answer.field === "tags") {
      tags = answer.value;
    } else {
      const property = answerProperty[answer.field];
      Object.assign(recipe, { [property]: answer.value });
    }
  }
  const answeredFields = new Set(answers.map(({ field }) => field));
  return Schema.decodeUnknownSync(RecipeReviewActionView)({
    ...current,
    answers: [...answerMap.values()],
    blockers: {
      invalidFields: current.blockers.invalidFields.filter(
        (field) => !answeredFields.has(field)
      ),
      unresolvedRequiredFields:
        current.blockers.unresolvedRequiredFields.filter(
          (field) => !answeredFields.has(field)
        ),
    },
    recipe,
    tags,
  });
};

const requirePublishable = (review: typeof RecipeReviewActionView.Type) => {
  const { ingredientLines, instructions, name } = review.recipe;
  if (
    review.blockers.invalidFields.length > 0 ||
    review.blockers.unresolvedRequiredFields.length > 0 ||
    ingredientLines === null ||
    instructions === null ||
    name === null ||
    review.tags === null
  ) {
    return Effect.fail(failure("illegal_transition"));
  }
  return Effect.succeed({
    ingredientLines,
    instructions,
    name,
    tags: review.tags,
  });
};

export const makeHouseholdRecipeImportRepository = (
  database: EffectSQLiteDoDatabase
) => {
  const canonicalEffect = HouseholdCanonicalEncoding.pipe(
    Effect.zip(HouseholdDigest),
    Effect.map(([canonical, digest]) => ({ canonical, digest }))
  );

  const digestJson = (value: Schema.Json) =>
    canonicalEffect.pipe(
      Effect.flatMap(({ canonical, digest }) =>
        canonical.encode(value).pipe(Effect.flatMap(digest.sha256))
      ),
      Effect.mapError(persistenceFailure)
    );

  const findIntentRow = (
    connection: EffectSQLiteDoDatabase,
    intentId: string
  ) =>
    connection
      .select()
      .from(householdRecipeImports)
      .where(eq(householdRecipeImports.intentId, intentId))
      .limit(1)
      .pipe(
        mapPersistence,
        Effect.map(([row]) =>
          row === undefined ? Option.none() : Option.some(row)
        )
      );

  const requireIntentRow = (
    connection: EffectSQLiteDoDatabase,
    intentId: string
  ) =>
    findIntentRow(connection, intentId).pipe(
      Effect.flatMap((row) =>
        Option.isSome(row)
          ? Effect.succeed(row.value)
          : Effect.fail(failure("intent_not_found"))
      )
    );

  const readIntentFromRow = (row: { readonly intentJson: string }) =>
    decode(EncodedIntent, row.intentJson);

  const persistLifecycleTimeline = (
    transaction: EffectSQLiteDoDatabase,
    input: {
      readonly intentId: string;
      readonly intentVersion: number;
      readonly timeline: Schema.Json | null;
    }
  ) =>
    input.timeline === null
      ? Effect.void
      : Effect.gen(function* persistRecipeImportLifecycleTimeline() {
          const eventJson = yield* encodeTimelineEvent(input.timeline);
          yield* transaction.insert(householdRecipeImportTimeline).values({
            eventJson,
            intentId: input.intentId,
            intentVersion: input.intentVersion,
          });
        });

  const readReceipt = <S extends Schema.Top>(
    connection: EffectSQLiteDoDatabase,
    mutationId: string,
    commandDigest: string,
    schema: S
  ) =>
    connection
      .select()
      .from(householdRecipeImportMutationReceipts)
      .where(eq(householdRecipeImportMutationReceipts.mutationId, mutationId))
      .limit(1)
      .pipe(
        mapPersistence,
        Effect.flatMap(([row]) => {
          if (row === undefined) {
            return Effect.succeed(Option.none<S["Type"]>());
          }
          if (row.commandDigest !== commandDigest) {
            return Effect.fail(failure("idempotency_conflict"));
          }
          return decode(Schema.fromJsonString(schema), row.resultJson).pipe(
            Effect.map(Option.some)
          );
        })
      );

  const prepareLifecycleTransition = (
    transaction: EffectSQLiteDoDatabase,
    input: HouseholdTransitionRecipeImportLifecycleInput,
    mutationId: string,
    commandDigest: string
  ) =>
    Effect.gen(function* prepareRecipeImportLifecycleTransition() {
      const replay = yield* readReceipt(
        transaction,
        mutationId,
        commandDigest,
        RecipeImportIntent
      );
      if (Option.isSome(replay)) {
        return { _tag: "Replay" as const, intent: replay.value };
      }
      const row = yield* requireIntentRow(transaction, input.intentId);
      if (row.executionGeneration !== input.expectedGeneration) {
        return yield* Effect.fail(failure("generation_conflict"));
      }
      const intent = yield* readIntentFromRow(row);
      if (intent.status !== "processing") {
        return yield* Effect.fail(failure("illegal_transition"));
      }
      return { _tag: "Prepared" as const, intent };
    });

  const persistReceipt = <S extends Schema.Top>(
    transaction: EffectSQLiteDoDatabase,
    input: {
      readonly commandDigest: string;
      readonly mutationId: string;
      readonly result: S["Type"];
      readonly schema: S;
    }
  ) =>
    encode(Schema.fromJsonString(input.schema), input.result).pipe(
      Effect.flatMap((resultJson) =>
        transaction.insert(householdRecipeImportMutationReceipts).values({
          commandDigest: input.commandDigest,
          mutationId: input.mutationId,
          resultJson,
        })
      ),
      mapPersistence,
      Effect.asVoid
    );

  const authorize = (
    organizationId: HouseholdAdmitRecipeImportInput["admission"]["organizationId"]
  ) =>
    ensureHouseholdProvenance(database, organizationId).pipe(
      Effect.mapError(persistenceFailure)
    );

  const admit = (input: HouseholdAdmitRecipeImportInput) =>
    Effect.gen(function* admitRecipeImport() {
      yield* authorize(input.admission.organizationId);
      const [idempotencyKeyDigest, requestDigest] = yield* Effect.all([
        digestJson({
          key: input.idempotencyKey,
          purpose: "recipe-import-idempotency",
          version: 1,
        }),
        digestJson({
          purpose: "recipe-import-request",
          source: input.source,
          version: 1,
        }),
      ]);
      const identities = yield* HouseholdIdentityGenerator;
      const [intentIdentity, dispatchIdentity, nowEpochMs] = yield* Effect.all([
        identities.generate(),
        identities.generate(),
        Clock.currentTimeMillis,
      ]).pipe(Effect.mapError(persistenceFailure));
      const intentId = yield* decode(RecipeImportIntentId, intentIdentity);
      const createdAt = instantFromEpoch(nowEpochMs);
      const intent = yield* decode(ProcessingRecipeImportIntent, {
        activity: { type: "working" },
        createdAt,
        id: intentId,
        intentVersion: 1,
        links: linksFor(intentId),
        object: "recipe_import_intent",
        processing: { startedAt: createdAt, type: "resolving_source" },
        source: { kind: "tiktok", resolution: "pending" },
        status: "processing",
        updatedAt: createdAt,
      });
      const importId = yield* decode(ImportId, intentId);
      const executionGeneration = yield* decode(
        ImportIntentExecutionGeneration,
        1
      );
      const workflowIdentity = yield* makeImportWorkflowIdentity({
        executionGeneration,
        importId,
      }).pipe(Effect.mapError(persistenceFailure));
      const dispatchId = yield* decode(HouseholdDispatchId, dispatchIdentity);
      const workflowAdmission = yield* decode(
        HouseholdImportWorkflowAdmissionResult,
        {
          committedAtEpochMs: nowEpochMs,
          dispatchId,
          workflowIdentity,
        }
      );
      const [intentJson, eventJson, workflowResultJson] = yield* Effect.all([
        encode(EncodedIntent, intent),
        encodeTimelineEvent({
          at: createdAt,
          intentVersion: 1,
          type: "intent_admitted",
        }),
        encode(EncodedAdmission, workflowAdmission),
      ]);
      const workflowMutationId = yield* digestJson({
        intentId,
        purpose: "import-workflow-admission",
        version: 1,
      });
      const workflowCommandDigest = yield* digestJson({
        executionGeneration: 1,
        intentId,
        purpose: "import-workflow-dispatch",
        version: 1,
      });
      const outboxPayloadJson = JSON.stringify({
        executionGeneration: 1,
        importId: intentId,
        workflowIdentity,
      });
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* commitAdmission() {
            const [existingRequest] = yield* transaction
              .select()
              .from(householdRecipeImportRequests)
              .where(
                eq(
                  householdRecipeImportRequests.idempotencyKeyDigest,
                  idempotencyKeyDigest
                )
              )
              .limit(1)
              .pipe(mapPersistence);
            if (existingRequest !== undefined) {
              if (existingRequest.requestDigest !== requestDigest) {
                return yield* Effect.fail(failure("idempotency_conflict"));
              }
              const row = yield* requireIntentRow(
                transaction,
                existingRequest.intentId
              );
              const [admissionRow] = yield* transaction
                .select()
                .from(householdImportWorkflowAdmissions)
                .where(
                  and(
                    eq(
                      householdImportWorkflowAdmissions.importId,
                      row.intentId
                    ),
                    eq(householdImportWorkflowAdmissions.executionGeneration, 1)
                  )
                )
                .limit(1)
                .pipe(mapPersistence);
              if (admissionRow === undefined) {
                return yield* Effect.fail(persistenceFailure());
              }
              const workflow = yield* decode(
                EncodedAdmission,
                admissionRow.committedResultJson
              );
              return {
                dispatchId: workflow.dispatchId,
                intent: yield* readIntentFromRow(row),
                workflowIdentity: workflow.workflowIdentity,
              };
            }
            yield* transaction.insert(householdRecipeImports).values({
              actionJson: null,
              actorId: input.admission.actor.actorId,
              canonicalSourceId: null,
              createdAt,
              evidenceFingerprint: null,
              executionGeneration: 1,
              extractionFingerprint: null,
              intentId,
              intentJson,
              recipeId: null,
              reviewJson: null,
              sourceKind: null,
              status: "processing",
              submittedSourceUrl: input.source.url,
              updatedAt: createdAt,
            });
            yield* transaction.insert(householdRecipeImportRequests).values({
              idempotencyKeyDigest,
              intentId,
              requestDigest,
            });
            yield* transaction.insert(householdRecipeImportTimeline).values({
              eventJson,
              intentId,
              intentVersion: 1,
            });
            yield* transaction
              .insert(householdImportWorkflowAdmissions)
              .values({
                commandDigest: workflowCommandDigest,
                committedAtEpochMs: nowEpochMs,
                committedResultJson: workflowResultJson,
                dispatchId,
                executionGeneration: 1,
                importId: intentId,
                mutationId: workflowMutationId,
                workflowIdentity,
              });
            yield* transaction.insert(householdOutbox).values({
              attempts: 0,
              dispatchId,
              exhaustedAtEpochMs: null,
              nextAttemptAtEpochMs: nowEpochMs,
              payloadJson: outboxPayloadJson,
              purpose: "import_workflow_dispatch",
              state: "pending",
            });
            return { dispatchId, intent, workflowIdentity };
          })
        )
        .pipe(mapTransaction);
    });

  const resolveSource = (input: HouseholdResolveRecipeImportSourceInput) =>
    Effect.gen(function* resolveRecipeImportSource() {
      yield* authorize(input.admission.organizationId);
      const commandDigest = yield* digestJson({
        canonicalSourceId: input.canonicalSourceId,
        canonicalUrl: input.canonicalUrl,
        expectedGeneration: input.expectedGeneration,
        intentId: input.intentId,
        operation: "resolve-source",
        sourceKind: input.sourceKind,
        version: 1,
      });
      const now = instantFromEpoch(yield* Clock.currentTimeMillis);
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* commitSourceResolution() {
            const transactionReplay = yield* readReceipt(
              transaction,
              input.mutationId,
              commandDigest,
              RecipeImportIntent
            );
            if (Option.isSome(transactionReplay)) {
              return transactionReplay.value;
            }
            const row = yield* requireIntentRow(transaction, input.intentId);
            if (row.executionGeneration !== input.expectedGeneration) {
              return yield* Effect.fail(failure("generation_conflict"));
            }
            const current = yield* readIntentFromRow(row);
            if (
              current.status !== "processing" ||
              current.processing.type !== "resolving_source"
            ) {
              return yield* Effect.fail(failure("illegal_transition"));
            }
            const [winner] = yield* transaction
              .select()
              .from(householdRecipeImports)
              .where(
                and(
                  eq(
                    householdRecipeImports.canonicalSourceId,
                    input.canonicalSourceId
                  ),
                  inArray(
                    householdRecipeImports.status,
                    householdLiveRecipeImportStatuses
                  )
                )
              )
              .orderBy(
                asc(householdRecipeImports.createdAt),
                asc(householdRecipeImports.intentId)
              )
              .limit(1)
              .pipe(mapPersistence);
            const currentWire = yield* encode(RecipeImportIntent, current);
            const nextVersion = current.intentVersion + 1;
            const next =
              winner === undefined
                ? yield* decode(ProcessingRecipeImportIntent, {
                    ...currentWire,
                    intentVersion: nextVersion,
                    processing: {
                      sourceKind: input.sourceKind,
                      startedAt: now,
                      type: "acquiring_media",
                    },
                    source: {
                      canonicalUrl: input.canonicalUrl,
                      kind: "tiktok",
                      resolution: "resolved",
                    },
                    updatedAt: now,
                  })
                : yield* decode(RedirectedRecipeImportIntent, {
                    ...currentWire,
                    intentVersion: nextVersion,
                    redirect: {
                      intentId: winner.intentId,
                      link: linksFor(winner.intentId).self,
                    },
                    redirectedAt: now,
                    source: {
                      canonicalUrl: input.canonicalUrl,
                      kind: "tiktok",
                      resolution: "resolved",
                    },
                    status: "redirected",
                    updatedAt: now,
                  });
            const eventJson = yield* next.status === "redirected"
              ? encodeTimelineEvent({
                  at: now,
                  intentVersion: nextVersion,
                  redirect: next.redirect,
                  type: "intent_redirected",
                })
              : encodeTimelineEvent({
                  at: now,
                  canonicalUrl: input.canonicalUrl,
                  intentVersion: nextVersion,
                  type: "source_resolved",
                });
            const intentJson = yield* encode(EncodedIntent, next);
            yield* transaction
              .update(householdRecipeImports)
              .set({
                canonicalSourceId: input.canonicalSourceId,
                intentJson,
                sourceKind: input.sourceKind,
                status: next.status,
                updatedAt: now,
              })
              .where(eq(householdRecipeImports.intentId, input.intentId));
            yield* transaction.insert(householdRecipeImportTimeline).values({
              eventJson,
              intentId: input.intentId,
              intentVersion: nextVersion,
            });
            yield* persistReceipt(transaction, {
              commandDigest,
              mutationId: input.mutationId,
              result: next,
              schema: RecipeImportIntent,
            });
            return next;
          })
        )
        .pipe(mapTransaction);
    });

  const commitDraft = (input: HouseholdCommitRecipeImportDraftInput) =>
    Effect.gen(function* commitRecipeImportDraft() {
      yield* authorize(input.admission.organizationId);
      const commandDigest = yield* digestJson({
        evidenceFingerprint: input.evidenceFingerprint,
        expectedGeneration: input.expectedGeneration,
        extractionFingerprint: input.extractionFingerprint,
        intentId: input.intentId,
        operation: "commit-draft",
        review: input.review,
        version: 1,
      });
      const resultSchema = Schema.Struct({
        action: ActiveRecipeImportAction,
        intent: RecipeImportIntent,
      });
      const now = instantFromEpoch(yield* Clock.currentTimeMillis);
      const actionId = yield* digestJson({
        executionGeneration: input.expectedGeneration,
        intentId: input.intentId,
        purpose: "review-recipe-action",
        version: 1,
      });
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* commitDraftTransaction() {
            const replay = yield* readReceipt(
              transaction,
              input.mutationId,
              commandDigest,
              resultSchema
            );
            if (Option.isSome(replay)) {
              return replay.value;
            }
            const row = yield* requireIntentRow(transaction, input.intentId);
            if (row.executionGeneration !== input.expectedGeneration) {
              return yield* Effect.fail(failure("generation_conflict"));
            }
            const current = yield* readIntentFromRow(row);
            if (
              current.status !== "processing" ||
              current.processing.type === "resolving_source"
            ) {
              return yield* Effect.fail(failure("illegal_transition"));
            }
            const action = yield* decode(ActiveRecipeImportAction, {
              actionVersion: 1,
              id: actionId,
              intentId: input.intentId,
              object: "recipe_import_action",
              review: input.review,
              status: "active",
              type: "review_recipe",
            });
            const currentWire = yield* encode(RecipeImportIntent, current);
            const next = yield* decode(RequiresActionRecipeImportIntent, {
              ...currentWire,
              action: {
                id: actionId,
                link: actionLink(input.intentId, actionId),
                type: "review_recipe",
              },
              intentVersion: current.intentVersion + 1,
              status: "requires_action",
              updatedAt: now,
            });
            const result = { action, intent: next };
            const [intentJson, actionJson, reviewJson, eventJson] =
              yield* Effect.all([
                encode(EncodedIntent, next),
                encode(EncodedAction, action),
                encode(EncodedReview, {
                  evidenceFingerprint: input.evidenceFingerprint,
                  extractionFingerprint: input.extractionFingerprint,
                  review: input.review,
                }),
                encodeTimelineEvent({
                  action: next.action,
                  at: now,
                  intentVersion: next.intentVersion,
                  type: "action_available",
                }),
              ]);
            yield* transaction
              .update(householdRecipeImports)
              .set({
                actionJson,
                evidenceFingerprint: input.evidenceFingerprint,
                extractionFingerprint: input.extractionFingerprint,
                intentJson,
                reviewJson,
                status: "requires_action",
                updatedAt: now,
              })
              .where(eq(householdRecipeImports.intentId, input.intentId));
            yield* transaction.insert(householdRecipeImportTimeline).values({
              eventJson,
              intentId: input.intentId,
              intentVersion: next.intentVersion,
            });
            yield* persistReceipt(transaction, {
              commandDigest,
              mutationId: input.mutationId,
              result,
              schema: resultSchema,
            });
            return result;
          })
        )
        .pipe(mapTransaction);
    });

  const transitionLifecycle = (
    input: HouseholdTransitionRecipeImportLifecycleInput
  ) =>
    Effect.gen(function* transitionRecipeImportLifecycle() {
      yield* authorize(input.admission.organizationId);
      const commandDigest = yield* digestJson({
        expectedGeneration: input.expectedGeneration,
        intentId: input.intentId,
        operation: "transition-lifecycle",
        transition: input.transition,
        version: 1,
      });
      const mutationId = yield* digestJson({
        expectedGeneration: input.expectedGeneration,
        intentId: input.intentId,
        semanticTransition: input.transition,
        version: 1,
      });
      const nowEpochMs = yield* Clock.currentTimeMillis;
      const now = instantFromEpoch(nowEpochMs);
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* commitLifecycleTransition() {
            const preparation = yield* prepareLifecycleTransition(
              transaction,
              input,
              mutationId,
              commandDigest
            );
            if (preparation._tag === "Replay") {
              return preparation.intent;
            }
            const current = preparation.intent;
            const currentWire = yield* encode(RecipeImportIntent, current);
            const currentActivityWire = yield* encode(
              ProcessingActivity,
              current.activity
            );
            let next: typeof RecipeImportIntent.Type;
            let timeline: Schema.Json | null = null;
            switch (input.transition._tag) {
              case "AdvanceStage": {
                const currentOrdinal = stageOrdinal(current.processing.type);
                const requestedOrdinal = stageOrdinal(input.transition.stage);
                if (requestedOrdinal <= currentOrdinal) {
                  yield* persistReceipt(transaction, {
                    commandDigest,
                    mutationId,
                    result: current,
                    schema: RecipeImportIntent,
                  });
                  return current;
                }
                if (requestedOrdinal !== currentOrdinal + 1) {
                  return yield* Effect.fail(failure("illegal_transition"));
                }
                const processing =
                  input.transition.stage === "analyzing_evidence"
                    ? {
                        speech: "not_started" as const,
                        startedAt: now,
                        type: "analyzing_evidence" as const,
                        visuals: "not_started" as const,
                      }
                    : {
                        startedAt: now,
                        type: input.transition.stage,
                      };
                next = yield* decode(ProcessingRecipeImportIntent, {
                  ...currentWire,
                  intentVersion: current.intentVersion + 1,
                  processing,
                  updatedAt: now,
                });
                timeline = {
                  at: now,
                  intentVersion: next.intentVersion,
                  processing,
                  type: "processing_stage_changed",
                };
                break;
              }
              case "AdvanceComponent": {
                if (current.processing.type !== "analyzing_evidence") {
                  return yield* Effect.fail(failure("illegal_transition"));
                }
                const existing = current.processing[input.transition.component];
                const progressOrder = [
                  "not_started",
                  "processing",
                  "completed",
                  "skipped",
                ];
                if (existing === input.transition.progress) {
                  yield* persistReceipt(transaction, {
                    commandDigest,
                    mutationId,
                    result: current,
                    schema: RecipeImportIntent,
                  });
                  return current;
                }
                if (
                  progressOrder.indexOf(input.transition.progress) <
                    progressOrder.indexOf(existing) ||
                  existing === "completed" ||
                  existing === "skipped"
                ) {
                  return yield* Effect.fail(failure("illegal_transition"));
                }
                const processing = {
                  ...(yield* encode(
                    ResolvedProcessingStage,
                    current.processing
                  )),
                  [input.transition.component]: input.transition.progress,
                };
                next = yield* decode(ProcessingRecipeImportIntent, {
                  ...currentWire,
                  intentVersion: current.intentVersion + 1,
                  processing,
                  updatedAt: now,
                });
                timeline = {
                  at: now,
                  intentVersion: next.intentVersion,
                  processing,
                  type: "processing_stage_changed",
                };
                break;
              }
              case "SetActivity": {
                const activity =
                  input.transition.activity === "retrying"
                    ? {
                        nextAttemptAt: instantFromEpoch(
                          nowEpochMs +
                            Math.min(
                              60_000,
                              2 ** input.transition.attempt * 1000
                            )
                        ),
                        type: "retrying" as const,
                      }
                    : { type: "working" as const };
                if (
                  currentActivityWire.type === activity.type &&
                  (activity.type === "working" ||
                    (currentActivityWire.type === "retrying" &&
                      currentActivityWire.nextAttemptAt ===
                        activity.nextAttemptAt))
                ) {
                  yield* persistReceipt(transaction, {
                    commandDigest,
                    mutationId,
                    result: current,
                    schema: RecipeImportIntent,
                  });
                  return current;
                }
                next = yield* decode(ProcessingRecipeImportIntent, {
                  ...currentWire,
                  activity,
                  intentVersion: current.intentVersion + 1,
                  updatedAt: now,
                });
                timeline =
                  activity.type === "retrying"
                    ? {
                        at: now,
                        intentVersion: next.intentVersion,
                        nextAttemptAt: activity.nextAttemptAt,
                        type: "retrying",
                      }
                    : {
                        at: now,
                        intentVersion: next.intentVersion,
                        type: "recovered",
                      };
                break;
              }
              case "Fail": {
                next = yield* decode(FailedRecipeImportIntent, {
                  ...currentWire,
                  error: {
                    code: input.transition.code,
                    message: input.transition.message,
                    recovery: input.transition.recovery,
                  },
                  failedAt: now,
                  intentVersion: current.intentVersion + 1,
                  status: "failed",
                  updatedAt: now,
                });
                timeline = {
                  at: now,
                  code: input.transition.code,
                  intentVersion: next.intentVersion,
                  type: "intent_failed",
                };
                break;
              }
              default: {
                return input.transition satisfies never;
              }
            }
            const intentJson = yield* encode(EncodedIntent, next);
            yield* transaction
              .update(householdRecipeImports)
              .set({
                intentJson,
                status: next.status,
                updatedAt: now,
              })
              .where(eq(householdRecipeImports.intentId, input.intentId));
            yield* persistLifecycleTimeline(transaction, {
              intentId: input.intentId,
              intentVersion: next.intentVersion,
              timeline,
            });
            yield* persistReceipt(transaction, {
              commandDigest,
              mutationId,
              result: next,
              schema: RecipeImportIntent,
            });
            return next;
          })
        )
        .pipe(mapTransaction);
    });

  const readExecution = (input: HouseholdReadRecipeImportExecutionInput) =>
    Effect.gen(function* readRecipeImportExecution() {
      yield* authorize(input.admission.organizationId);
      const row = yield* requireIntentRow(database, input.intentId);
      if (row.executionGeneration !== input.expectedGeneration) {
        return yield* Effect.fail(failure("generation_conflict"));
      }
      const intent = yield* readIntentFromRow(row);
      if (intent.status !== "processing" && intent.status !== "failed") {
        return yield* Effect.fail(failure("illegal_transition"));
      }
      if (row.canonicalSourceId === null || row.sourceKind === null) {
        return yield* Effect.fail(failure("illegal_transition"));
      }
      const [evidence] = yield* database
        .select({
          acquisitionAttemptGeneration:
            householdImportEvidenceExecutions.acquisitionAttemptGeneration,
        })
        .from(householdImportEvidenceExecutions)
        .where(
          and(
            eq(householdImportEvidenceExecutions.intentId, input.intentId),
            eq(
              householdImportEvidenceExecutions.executionGeneration,
              input.expectedGeneration
            )
          )
        )
        .limit(1)
        .pipe(mapPersistence);
      const [workflow] = yield* database
        .select({
          originalTraceJson:
            householdImportWorkflowAdmissions.originalTraceJson,
          workflowIdentity: householdImportWorkflowAdmissions.workflowIdentity,
        })
        .from(householdImportWorkflowAdmissions)
        .where(
          and(
            eq(householdImportWorkflowAdmissions.importId, input.intentId),
            eq(
              householdImportWorkflowAdmissions.executionGeneration,
              input.expectedGeneration
            )
          )
        )
        .limit(1)
        .pipe(mapPersistence);
      if (workflow === undefined || workflow.originalTraceJson === null) {
        return yield* Effect.fail(failure("illegal_transition"));
      }
      const originalTraceText = workflow.originalTraceJson;
      const originalTraceJson = yield* Effect.try({
        catch: persistenceFailure,
        try: () => JSON.parse(originalTraceText) as Schema.Json,
      });
      const originalTrace = yield* decode(
        ImportTraceContext,
        originalTraceJson
      );
      return yield* decode(HouseholdRecipeImportExecutionView, {
        acquisitionAttemptGeneration:
          evidence?.acquisitionAttemptGeneration ?? null,
        canonicalSourceId: row.canonicalSourceId,
        executionGeneration: row.executionGeneration,
        intentId: row.intentId,
        originalTrace,
        sourceKind: row.sourceKind,
        submittedSourceUrl: row.submittedSourceUrl,
        workflowIdentity: workflow.workflowIdentity,
      });
    });

  const answer = (input: HouseholdAnswerRecipeImportActionInput) =>
    Effect.gen(function* answerRecipeImportAction() {
      yield* authorize(input.admission.organizationId);
      const mutationId = yield* digestJson({
        actionId: input.actionId,
        actorId: input.admission.actor.actorId,
        idempotencyKey: input.idempotencyKey,
        intentId: input.intentId,
        operation: "answer-review",
        version: 1,
      });
      const commandDigest = yield* digestJson({
        actionId: input.actionId,
        answers: input.request.answers,
        expectedActionVersion: input.request.expectedActionVersion,
        intentId: input.intentId,
        operation: "answer-review",
        version: 1,
      });
      const now = instantFromEpoch(yield* Clock.currentTimeMillis);
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* commitReviewAnswers() {
            const replay = yield* readReceipt(
              transaction,
              mutationId,
              commandDigest,
              RecipeImportIntent
            );
            if (Option.isSome(replay)) {
              return replay.value;
            }
            const row = yield* requireIntentRow(transaction, input.intentId);
            if (row.actionJson === null || row.reviewJson === null) {
              return yield* Effect.fail(failure("action_not_found"));
            }
            const [intent, action, storedReview] = yield* Effect.all([
              readIntentFromRow(row),
              decode(EncodedAction, row.actionJson),
              decode(EncodedReview, row.reviewJson),
            ]);
            if (
              action.status !== "active" ||
              action.id !== input.actionId ||
              action.actionVersion !== input.request.expectedActionVersion ||
              intent.status !== "requires_action"
            ) {
              return yield* Effect.fail(
                action.actionVersion === input.request.expectedActionVersion
                  ? failure("illegal_transition")
                  : failure("version_conflict")
              );
            }
            const review = applyAnswers(
              storedReview.review,
              input.request.answers
            );
            const nextAction = yield* decode(ActiveRecipeImportAction, {
              ...action,
              actionVersion: action.actionVersion + 1,
              review,
            });
            const intentWire = yield* encode(RecipeImportIntent, intent);
            const nextIntent = yield* decode(RequiresActionRecipeImportIntent, {
              ...intentWire,
              updatedAt: now,
            });
            const [actionJson, intentJson, reviewJson] = yield* Effect.all([
              encode(EncodedAction, nextAction),
              encode(EncodedIntent, nextIntent),
              encode(EncodedReview, { ...storedReview, review }),
            ]);
            yield* transaction
              .update(householdRecipeImports)
              .set({
                actionJson,
                intentJson,
                reviewJson,
                updatedAt: now,
              })
              .where(eq(householdRecipeImports.intentId, input.intentId));
            yield* Effect.forEach(
              input.request.answers,
              (correction, ordinal) =>
                transaction.insert(householdRecipeReviewCorrections).values({
                  actionVersion: nextAction.actionVersion,
                  correctionJson: JSON.stringify({
                    actorId: input.admission.actor.actorId,
                    answeredAt: now,
                    correction,
                  }),
                  intentId: input.intentId,
                  ordinal,
                }),
              { discard: true }
            );
            yield* persistReceipt(transaction, {
              commandDigest,
              mutationId,
              result: nextIntent,
              schema: RecipeImportIntent,
            });
            return nextIntent;
          })
        )
        .pipe(mapTransaction);
    });

  const confirm = (input: HouseholdConfirmRecipeImportActionInput) =>
    Effect.gen(function* confirmRecipeImportAction() {
      yield* authorize(input.admission.organizationId);
      const mutationId = yield* digestJson({
        actionId: input.actionId,
        actorId: input.admission.actor.actorId,
        idempotencyKey: input.idempotencyKey,
        intentId: input.intentId,
        operation: "confirm-review",
        version: 1,
      });
      const commandDigest = yield* digestJson({
        actionId: input.actionId,
        expectedActionVersion: input.request.expectedActionVersion,
        intentId: input.intentId,
        operation: "confirm-review",
        version: 1,
      });
      const replay = yield* readReceipt(
        database,
        mutationId,
        commandDigest,
        SucceededRecipeImportIntent
      );
      if (Option.isSome(replay)) {
        return replay.value;
      }
      const identities = yield* HouseholdIdentityGenerator;
      const [recipeIdentity, nowEpochMs] = yield* Effect.all([
        identities.generate(),
        Clock.currentTimeMillis,
      ]).pipe(Effect.mapError(persistenceFailure));
      const recipeId = yield* decode(Recipe.fields.id, recipeIdentity);
      const confirmedAt = instantFromEpoch(nowEpochMs);
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* confirmReviewAndPublish() {
            const transactionReplay = yield* readReceipt(
              transaction,
              mutationId,
              commandDigest,
              SucceededRecipeImportIntent
            );
            if (Option.isSome(transactionReplay)) {
              return transactionReplay.value;
            }
            const row = yield* requireIntentRow(transaction, input.intentId);
            if (row.actionJson === null || row.reviewJson === null) {
              return yield* Effect.fail(failure("action_not_found"));
            }
            const [intent, action, storedReview] = yield* Effect.all([
              readIntentFromRow(row),
              decode(EncodedAction, row.actionJson),
              decode(EncodedReview, row.reviewJson),
            ]);
            if (
              action.status !== "active" ||
              action.id !== input.actionId ||
              intent.status !== "requires_action"
            ) {
              return yield* Effect.fail(failure("illegal_transition"));
            }
            if (action.actionVersion !== input.request.expectedActionVersion) {
              return yield* Effect.fail(failure("version_conflict"));
            }
            const publishable = yield* requirePublishable(action.review);
            const finalizingVersion = intent.intentVersion + 1;
            const succeededVersion = finalizingVersion + 1;
            const publicRecipe = yield* decode(Recipe, {
              id: recipeId,
              object: "recipe",
              recipe: action.review.recipe,
              tags: publishable.tags,
            });
            const planningRecipe = yield* decode(MealPlanRecipeSnapshot, {
              approvedAt: confirmedAt,
              extractionFingerprint: storedReview.extractionFingerprint,
              importId: input.intentId,
              recipe: {
                ingredientLines: publishable.ingredientLines,
                instructions: publishable.instructions,
                name: publishable.name,
              },
              source: {
                evidenceFingerprint: storedReview.evidenceFingerprint,
                sourceUrl:
                  intent.source.resolution === "resolved"
                    ? intent.source.canonicalUrl
                    : null,
              },
              tags: publishable.tags,
              version: 1,
            });
            const completedAction = yield* decode(CompletedRecipeImportAction, {
              ...action,
              completion: { confirmedAt, type: "confirmed" },
              status: "completed",
            });
            const intentWire = yield* encode(RecipeImportIntent, intent);
            const succeeded = yield* decode(SucceededRecipeImportIntent, {
              ...intentWire,
              completedAt: confirmedAt,
              intentVersion: succeededVersion,
              result: { recipeId },
              status: "succeeded",
              updatedAt: confirmedAt,
            });
            const [
              intentJson,
              actionJson,
              publicRecipeJson,
              planningRecipeJson,
              finalizingEventJson,
              succeededEventJson,
            ] = yield* Effect.all([
              encode(EncodedIntent, succeeded),
              encode(EncodedAction, completedAction),
              encode(EncodedRecipe, publicRecipe),
              encode(EncodedPlanningRecipe, planningRecipe),
              encodeTimelineEvent({
                at: confirmedAt,
                intentVersion: finalizingVersion,
                processing: {
                  startedAt: confirmedAt,
                  type: "finalizing_recipe",
                },
                type: "processing_stage_changed",
              }),
              encodeTimelineEvent({
                at: confirmedAt,
                intentVersion: succeededVersion,
                recipeId,
                type: "intent_succeeded",
              }),
            ]);
            const textEncoder = new TextEncoder();
            if (
              textEncoder.encode(publicRecipeJson).byteLength >
                householdRecipeMaximumEncodedBytes ||
              textEncoder.encode(planningRecipeJson).byteLength >
                householdRecipeMaximumEncodedBytes
            ) {
              return yield* Effect.fail(failure("invalid_input"));
            }
            yield* transaction.insert(householdRecipes).values({
              importId: input.intentId,
              planningRecipeJson,
              publicRecipeJson,
              publishedAt: confirmedAt,
              recipeId,
              version: 1,
            });
            yield* transaction.insert(householdRecipeReviewTransitions).values({
              intentId: input.intentId,
              transitionJson: JSON.stringify({
                actorId: input.admission.actor.actorId,
                from: "needs_review",
                to: "approved",
                transitionedAt: confirmedAt,
              }),
              version: completedAction.actionVersion,
            });
            yield* transaction
              .update(householdRecipeImports)
              .set({
                actionJson,
                intentJson,
                recipeId,
                status: "succeeded",
                updatedAt: confirmedAt,
              })
              .where(eq(householdRecipeImports.intentId, input.intentId));
            yield* transaction.insert(householdRecipeImportTimeline).values([
              {
                eventJson: finalizingEventJson,
                intentId: input.intentId,
                intentVersion: finalizingVersion,
              },
              {
                eventJson: succeededEventJson,
                intentId: input.intentId,
                intentVersion: succeededVersion,
              },
            ]);
            yield* persistReceipt(transaction, {
              commandDigest,
              mutationId,
              result: succeeded,
              schema: SucceededRecipeImportIntent,
            });
            return succeeded;
          })
        )
        .pipe(mapTransaction);
    });

  const cancel = (input: HouseholdCancelRecipeImportInput) =>
    Effect.gen(function* cancelRecipeImport() {
      yield* authorize(input.admission.organizationId);
      const mutationId = yield* digestJson({
        actorId: input.admission.actor.actorId,
        idempotencyKey: input.idempotencyKey,
        intentId: input.intentId,
        operation: "cancel-import",
        version: 1,
      });
      const commandDigest = yield* digestJson({
        expectedIntentVersion: input.request.expectedIntentVersion,
        intentId: input.intentId,
        operation: "cancel-import",
        version: 1,
      });
      const now = instantFromEpoch(yield* Clock.currentTimeMillis);
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* commitCancellation() {
            const replay = yield* readReceipt(
              transaction,
              mutationId,
              commandDigest,
              CancelledRecipeImportIntent
            );
            if (Option.isSome(replay)) {
              return replay.value;
            }
            const row = yield* requireIntentRow(transaction, input.intentId);
            const intent = yield* readIntentFromRow(row);
            if (intent.intentVersion !== input.request.expectedIntentVersion) {
              return yield* Effect.fail(failure("version_conflict"));
            }
            if (
              intent.status === "succeeded" ||
              intent.status === "cancelled" ||
              intent.status === "redirected"
            ) {
              return yield* Effect.fail(failure("illegal_transition"));
            }
            const intentWire = yield* encode(RecipeImportIntent, intent);
            const cancelled = yield* decode(CancelledRecipeImportIntent, {
              ...intentWire,
              cancelledAt: now,
              intentVersion: intent.intentVersion + 1,
              status: "cancelled",
              updatedAt: now,
            });
            const [intentJson, eventJson] = yield* Effect.all([
              encode(EncodedIntent, cancelled),
              encodeTimelineEvent({
                at: now,
                intentVersion: cancelled.intentVersion,
                type: "intent_cancelled",
              }),
            ]);
            yield* transaction
              .update(householdRecipeImports)
              .set({
                actionJson: null,
                intentJson,
                status: "cancelled",
                updatedAt: now,
              })
              .where(eq(householdRecipeImports.intentId, input.intentId));
            yield* transaction.insert(householdRecipeImportTimeline).values({
              eventJson,
              intentId: input.intentId,
              intentVersion: cancelled.intentVersion,
            });
            yield* persistReceipt(transaction, {
              commandDigest,
              mutationId,
              result: cancelled,
              schema: CancelledRecipeImportIntent,
            });
            return cancelled;
          })
        )
        .pipe(mapTransaction);
    });

  const readIntent = (input: typeof HouseholdReadRecipeImportInput.Type) =>
    Effect.andThen(
      authorize(input.admission.organizationId),
      requireIntentRow(database, input.intentId)
    ).pipe(Effect.flatMap(readIntentFromRow));

  const readAction = (
    input: typeof HouseholdReadRecipeImportActionInput.Type
  ) =>
    Effect.andThen(
      authorize(input.admission.organizationId),
      requireIntentRow(database, input.intentId)
    ).pipe(
      Effect.flatMap((row) =>
        row.actionJson === null
          ? Effect.fail(failure("action_not_found"))
          : decode(EncodedAction, row.actionJson)
      ),
      Effect.filterOrFail(
        (action) => action.id === input.actionId,
        () => failure("action_not_found")
      )
    );

  const readTimeline = (input: typeof HouseholdReadRecipeImportInput.Type) =>
    Effect.andThen(
      authorize(input.admission.organizationId),
      requireIntentRow(database, input.intentId)
    ).pipe(
      Effect.andThen(
        database
          .select()
          .from(householdRecipeImportTimeline)
          .where(eq(householdRecipeImportTimeline.intentId, input.intentId))
          .orderBy(asc(householdRecipeImportTimeline.intentVersion))
          .pipe(mapPersistence)
      ),
      Effect.flatMap((rows) =>
        Effect.forEach((row: (typeof rows)[number]) =>
          decode(EncodedTimelineEvent, row.eventJson)
        )(rows)
      ),
      Effect.map((data) => ({ data, object: "list" as const }))
    );

  const readRecipe = (input: typeof HouseholdReadRecipeInput.Type) =>
    Effect.andThen(
      authorize(input.admission.organizationId),
      database
        .select()
        .from(householdRecipes)
        .where(eq(householdRecipes.recipeId, input.recipeId))
        .limit(1)
        .pipe(mapPersistence)
    ).pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.fail(failure("recipe_not_found"))
          : decode(EncodedRecipe, rows[0].publicRecipeJson)
      )
    );

  const readPlanningRecipe = (
    admission: (typeof HouseholdReadRecipeInput.Type)["admission"],
    importId: typeof MealPlanRecipeSnapshot.Type.importId
  ) =>
    Effect.andThen(
      authorize(admission.organizationId),
      database
        .select()
        .from(householdRecipes)
        .where(eq(householdRecipes.importId, importId))
        .limit(1)
        .pipe(mapPersistence)
    ).pipe(
      Effect.flatMap(([row]) =>
        row === undefined
          ? Effect.fail(failure("recipe_not_found"))
          : decode(EncodedPlanningRecipe, row.planningRecipeJson)
      )
    );

  const listRecipePage = (input: typeof HouseholdRecipePageInput.Type) =>
    Effect.gen(function* listHouseholdRecipePage() {
      yield* authorize(input.admission.organizationId);
      const where =
        input.cursor === null
          ? undefined
          : gt(householdRecipes.recipeId, input.cursor);
      const rows = yield* database
        .select()
        .from(householdRecipes)
        .where(where)
        .orderBy(asc(householdRecipes.recipeId))
        .limit(input.limit + 1)
        .pipe(mapPersistence);
      const items: (typeof MealPlanRecipeSnapshot.Type)[] = [];
      const includedRecipeIds: string[] = [];
      let bytes = 0;
      for (const row of rows.slice(0, input.limit)) {
        const item = yield* decode(
          EncodedPlanningRecipe,
          row.planningRecipeJson
        );
        const itemBytes = new TextEncoder().encode(
          row.planningRecipeJson
        ).byteLength;
        if (items.length > 0 && bytes + itemBytes > input.byteLimit) {
          break;
        }
        if (itemBytes > input.byteLimit) {
          return yield* Effect.fail(failure("persistence_unavailable"));
        }
        items.push(item);
        includedRecipeIds.push(row.recipeId);
        bytes += itemBytes;
      }
      const lastRecipeId = includedRecipeIds.at(-1);
      const hasMore =
        lastRecipeId !== undefined &&
        (rows.length > items.length || items.length === input.limit);
      return {
        items,
        nextCursor: hasMore
          ? yield* decode(HouseholdRecipePageCursor, lastRecipeId)
          : null,
      };
    });

  return {
    admit,
    answer,
    cancel,
    commitDraft,
    confirm,
    listRecipePage,
    readAction,
    readExecution,
    readIntent,
    readPlanningRecipe,
    readRecipe,
    readTimeline,
    resolveSource,
    transitionLifecycle,
  };
};
