import {
  RecipeId,
  RecipeImportActionVersion,
  RecipeImportIntentId,
  RequiresActionRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import type {
  RecipeImportActionId,
  RecipeReviewAnswer,
  SucceededRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, Effect, Exit, Option, Schema } from "effect";

import {
  projectActiveRecipeImportAction,
  projectCompletedRecipeImportAction,
} from "./import-intent-review-action.js";
import type {
  AnswerRecipeImportActionCommand,
  ConfirmRecipeImportActionCommand,
  RecipeImportActionCommandDigest,
  RecipeImportActionMutationId,
  RecipeImportIntentReviewRepository,
} from "./import-intent-review.js";
import {
  RecipeImportActionMutationConflict,
  RecipeImportActionNotFound,
  RecipeImportActionTransitionRejected,
  RecipeImportActionVersionConflict,
  RecipeImportRecipeNotFound,
  projectPublicRecipe,
} from "./import-intent-review.js";
import type { ImportPrincipal } from "./import-intent.js";
import type { Review } from "./import-recipe-review.js";
import {
  approvalBlockers,
  applyCorrectionOverlay,
} from "./import-recipe-review.js";
import { makeD1RecipeReviewRepository } from "./import-recipe-review.repository.d1.js";
import { ImportId } from "./import.contracts.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
} from "./import.errors.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Number);

const ActionSourceRow = Schema.Struct({
  active_action_id: NullableString,
  active_action_version: NullableNumber,
  extraction_fingerprint: NullableString,
  intent_version: Schema.Number,
  public_status: Schema.String,
});
type ActionSourceRow = typeof ActionSourceRow.Type;

const ActionMutationReplayRow = Schema.Struct({
  action_id: NullableString,
  command_digest: Schema.String,
  created_at: Schema.String,
  intent_version: NullableNumber,
  mutation_id: Schema.String,
  occurred_at: NullableString,
  public_source_url: NullableString,
  resulting_version: Schema.Number,
});
type ActionMutationReplayRow = typeof ActionMutationReplayRow.Type;

const ConfirmMutationReplayRow = Schema.Struct({
  action_id: NullableString,
  command_digest: Schema.String,
  event_type: NullableString,
  public_stage: NullableString,
  public_status: Schema.String,
});

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: () => Promise.resolve(operation()),
  });

const asImportId = (intentId: RecipeImportIntentId) =>
  Schema.decodeUnknownSync(ImportId)(intentId);

const requireReview = (
  binding: AnyD1Database,
  intentId: RecipeImportIntentId
) =>
  makeD1RecipeReviewRepository(binding)
    .find(asImportId(intentId))
    .pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(importPersistenceCorrupt()),
          onSome: Effect.succeed,
        })
      )
    );

const readActionSource = (
  binding: AnyD1Database,
  principal: ImportPrincipal,
  intentId: RecipeImportIntentId
) =>
  Effect.gen(function* readOwnedActionSource() {
    const raw = yield* persistenceEffect(() =>
      binding
        .prepare(
          `SELECT parent.active_action_id, parent.active_action_version,
                  extraction.extraction_fingerprint, parent.intent_version,
                  parent.public_status
             FROM recipe_imports AS parent
             LEFT JOIN import_recipe_extractions AS extraction
               ON extraction.import_id = parent.id AND extraction.is_current = 1
            WHERE parent.household_scope_id = ? AND parent.id = ?
            LIMIT 1`
        )
        .bind(principal.householdScopeId, intentId)
        .first()
    );
    if (raw === null) {
      return Option.none<ActionSourceRow>();
    }
    const row = yield* Schema.decodeUnknownEffect(ActionSourceRow, {
      onExcessProperty: "ignore",
    })(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()));
    return Option.some(row);
  });

const actionBelongsToIntent = (
  binding: AnyD1Database,
  principal: ImportPrincipal,
  intentId: RecipeImportIntentId,
  actionId: RecipeImportActionId
) =>
  persistenceEffect(() =>
    binding
      .prepare(
        `SELECT 1
           FROM recipe_imports AS parent
           JOIN recipe_import_intent_history AS history
             ON history.intent_id = parent.id
          WHERE parent.household_scope_id = ? AND parent.id = ?
            AND history.event_type = 'action_available'
            AND history.action_id = ?
          LIMIT 1`
      )
      .bind(principal.householdScopeId, intentId, actionId)
      .first()
  ).pipe(Effect.map((row) => row !== null));

const readMutationReplay = (
  binding: AnyD1Database,
  input: {
    readonly commandDigest: RecipeImportActionCommandDigest;
    readonly intentId: RecipeImportIntentId;
    readonly mutationId: RecipeImportActionMutationId;
    readonly principal: ImportPrincipal;
  }
) =>
  Effect.gen(function* readRecipeImportActionMutationReplay() {
    const raw = yield* persistenceEffect(() =>
      binding
        .prepare(
          `SELECT history.action_id, mutation.command_digest, parent.created_at,
                  history.intent_version, mutation.mutation_id,
                  history.occurred_at, parent.public_source_url,
                  mutation.resulting_version
             FROM recipe_imports AS parent
             JOIN import_recipe_extractions AS extraction
               ON extraction.import_id = parent.id AND extraction.is_current = 1
             JOIN recipe_review_mutations AS mutation
               ON mutation.extraction_fingerprint = extraction.extraction_fingerprint
             LEFT JOIN recipe_import_intent_history AS history
               ON history.intent_id = parent.id
              AND history.mutation_id = mutation.mutation_id
            WHERE parent.household_scope_id = ? AND parent.id = ?
              AND mutation.mutation_id = ?
            LIMIT 1`
        )
        .bind(
          input.principal.householdScopeId,
          input.intentId,
          input.mutationId
        )
        .first()
    );
    if (raw === null) {
      return Option.none<ActionMutationReplayRow>();
    }
    const row = yield* Schema.decodeUnknownEffect(ActionMutationReplayRow, {
      onExcessProperty: "ignore",
    })(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()));
    if (row.command_digest !== input.commandDigest) {
      return yield* Effect.fail(new RecipeImportActionMutationConflict());
    }
    return Option.some(row);
  });

const replayedAnswerIntent = (
  intentId: RecipeImportIntentId,
  actionId: RecipeImportActionId,
  row: ActionMutationReplayRow
) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: () => {
      if (
        row.action_id !== actionId ||
        row.intent_version === null ||
        row.occurred_at === null ||
        row.public_source_url === null
      ) {
        throw new Error("Incomplete answer replay");
      }
      return Schema.decodeUnknownSync(RequiresActionRecipeImportIntent)({
        action: {
          id: actionId,
          link: `/v1/recipe-import-intents/${intentId}/actions/${actionId}`,
          type: "review_recipe",
        },
        createdAt: row.created_at,
        id: intentId,
        intentVersion: row.intent_version,
        links: {
          self: `/v1/recipe-import-intents/${intentId}`,
          timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
        },
        object: "recipe_import_intent",
        source: {
          canonicalUrl: row.public_source_url,
          kind: "tiktok",
          resolution: "resolved",
        },
        status: "requires_action",
        updatedAt: row.occurred_at,
      });
    },
  });

const readAnswerReplay = (
  binding: AnyD1Database,
  command: AnswerRecipeImportActionCommand
) =>
  readMutationReplay(binding, command).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.succeed(
            Option.none<typeof RequiresActionRecipeImportIntent.Type>()
          ),
        onSome: (row) =>
          replayedAnswerIntent(command.intentId, command.actionId, row).pipe(
            Effect.map(Option.some)
          ),
      })
    )
  );

const readConfirmReplay = (
  binding: AnyD1Database,
  command: ConfirmRecipeImportActionCommand
) =>
  Effect.gen(function* readRecipeImportConfirmReplay() {
    const raw = yield* persistenceEffect(() =>
      binding
        .prepare(
          `SELECT mutation.command_digest, finalizing.event_type,
                  finalizing.public_stage, parent.public_status,
                  (
                    SELECT available.action_id
                      FROM recipe_import_intent_history AS available
                     WHERE available.intent_id = parent.id
                       AND available.event_type = 'action_available'
                       AND available.intent_version < finalizing.intent_version
                     ORDER BY available.intent_version DESC
                     LIMIT 1
                  ) AS action_id
             FROM recipe_imports AS parent
             JOIN import_recipe_extractions AS extraction
               ON extraction.import_id = parent.id AND extraction.is_current = 1
             JOIN recipe_review_mutations AS mutation
               ON mutation.extraction_fingerprint = extraction.extraction_fingerprint
             LEFT JOIN recipe_import_intent_history AS finalizing
               ON finalizing.intent_id = parent.id
              AND finalizing.mutation_id = mutation.mutation_id
            WHERE parent.household_scope_id = ? AND parent.id = ?
              AND mutation.mutation_id = ?
            LIMIT 1`
        )
        .bind(
          command.principal.householdScopeId,
          command.intentId,
          command.mutationId
        )
        .first()
    );
    if (raw === null) {
      return Option.none<SucceededRecipeImportIntent>();
    }
    const row = yield* Schema.decodeUnknownEffect(ConfirmMutationReplayRow, {
      onExcessProperty: "ignore",
    })(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()));
    if (row.command_digest !== command.commandDigest) {
      return yield* Effect.fail(new RecipeImportActionMutationConflict());
    }
    if (
      row.action_id !== command.actionId ||
      row.event_type !== "processing_stage_changed" ||
      row.public_stage !== "finalizing_recipe" ||
      row.public_status !== "succeeded"
    ) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    const intent = yield* makeD1ImportRepository(binding).findIntent(
      command.principal,
      command.intentId
    );
    if (Option.isNone(intent) || intent.value.status !== "succeeded") {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    return Option.some(intent.value);
  });

const currentAnswerValue = (
  review: Review,
  answer: RecipeReviewAnswer
): Schema.Json => {
  if (answer.field === "tags") {
    return review.tags;
  }
  const recipe = applyCorrectionOverlay(review.draft, review.corrections);
  switch (answer.field) {
    case "author": {
      return recipe.author;
    }
    case "category": {
      return recipe.category;
    }
    case "cook_time_minutes": {
      return recipe.cookTimeMinutes;
    }
    case "cuisine": {
      return recipe.cuisine;
    }
    case "description": {
      return recipe.description;
    }
    case "ingredient_lines": {
      return recipe.ingredientLines;
    }
    case "ingredient_quantities": {
      return recipe.ingredientQuantities;
    }
    case "ingredient_units": {
      return recipe.ingredientUnits;
    }
    case "instructions": {
      return recipe.instructions;
    }
    case "name": {
      return recipe.name;
    }
    case "nutrition": {
      return recipe.nutrition;
    }
    case "prep_time_minutes": {
      return recipe.prepTimeMinutes;
    }
    case "temperature_celsius": {
      return recipe.temperatureCelsius;
    }
    case "tools": {
      return recipe.tools;
    }
    case "total_time_minutes": {
      return recipe.totalTimeMinutes;
    }
    case "yield": {
      return recipe.yield;
    }
    default: {
      return answer satisfies never;
    }
  }
};

const requireCurrentAnswerState = (
  binding: AnyD1Database,
  command: AnswerRecipeImportActionCommand | ConfirmRecipeImportActionCommand
) =>
  Effect.gen(function* requireCurrentRecipeImportAnswerState() {
    const source = yield* readActionSource(
      binding,
      command.principal,
      command.intentId
    );
    if (Option.isNone(source)) {
      return yield* Effect.fail(new RecipeImportActionNotFound());
    }
    const row = source.value;
    if (
      row.public_status !== "requires_action" ||
      row.active_action_id !== command.actionId
    ) {
      return yield* Effect.fail(new RecipeImportActionTransitionRejected());
    }
    if (
      row.active_action_version === null ||
      row.active_action_version !== command.request.expectedActionVersion
    ) {
      return yield* Effect.fail(new RecipeImportActionVersionConflict());
    }
    if (row.extraction_fingerprint === null) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    const review = yield* requireReview(binding, command.intentId);
    if (
      review._tag !== "NeedsReview" ||
      review.version + 1 !== row.active_action_version
    ) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    return { review, row };
  });

const answerAction = (
  binding: AnyD1Database,
  command: AnswerRecipeImportActionCommand
) =>
  Effect.gen(function* answerRecipeImportAction() {
    const replay = yield* readAnswerReplay(binding, command);
    if (Option.isSome(replay)) {
      return replay.value;
    }
    const { review, row } = yield* requireCurrentAnswerState(binding, command);
    const resultingReviewVersion = review.version + 1;
    const resultingActionVersion = Schema.decodeUnknownSync(
      RecipeImportActionVersion
    )(command.request.expectedActionVersion + 1);
    const tags =
      command.request.answers.find((answer) => answer.field === "tags")
        ?.value ?? review.tags;
    const tagsBeforeJson = JSON.stringify(review.tags);
    const tagsAfterJson = JSON.stringify(tags);
    const materializedTagsAfterJson = tags === null ? null : tagsAfterJson;
    const correctionStatements = command.request.answers
      .toSorted((left, right) => left.field.localeCompare(right.field))
      .map((answer, ordinal) =>
        binding
          .prepare(
            `INSERT INTO recipe_review_corrections (
               extraction_fingerprint, version, ordinal, actor_id, field,
               before_json, after_json, reason, tags_before_json,
               tags_after_json, corrected_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              WHERE changes() = 1`
          )
          .bind(
            row.extraction_fingerprint,
            resultingReviewVersion,
            ordinal,
            command.actorId,
            answer.field,
            JSON.stringify(currentAnswerValue(review, answer)),
            JSON.stringify(answer.value),
            "Household answered recipe review action",
            tagsBeforeJson,
            tagsAfterJson,
            command.answeredAt
          )
      );
    const applied = yield* Effect.exit(
      persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `UPDATE recipe_imports
                  SET active_action_version = ?, intent_version = intent_version + 1,
                      transition_mutation_id = ?, transition_command_digest = ?,
                      transition_actor_category = 'household_member',
                      transition_actor_identity_hash = ?,
                      transition_provenance_version = intent_version + 1,
                      updated_at = ?
                WHERE id = ? AND household_scope_id = ?
                  AND public_status = 'requires_action'
                  AND active_action_id = ? AND active_action_version = ?
                  AND intent_version = ?`
            )
            .bind(
              resultingActionVersion,
              command.mutationId,
              command.commandDigest,
              command.principal.actorId,
              command.answeredAt,
              command.intentId,
              command.principal.householdScopeId,
              command.actionId,
              command.request.expectedActionVersion,
              row.intent_version
            ),
          binding
            .prepare(
              `UPDATE recipe_reviews
                  SET version = version + 1, tags_json = ?, updated_at = ?
                WHERE extraction_fingerprint = ? AND version = ?
                  AND lifecycle = 'needs_review'
                  AND EXISTS (
                    SELECT 1 FROM recipe_import_intent_history AS history
                     WHERE history.intent_id = ? AND history.mutation_id = ?
                       AND history.command_digest = ?
                       AND history.event_type = 'action_available'
                  )`
            )
            .bind(
              materializedTagsAfterJson,
              command.answeredAt,
              row.extraction_fingerprint,
              review.version,
              command.intentId,
              command.mutationId,
              command.commandDigest
            ),
          ...correctionStatements,
          binding
            .prepare(
              `INSERT INTO recipe_review_mutations (
                 extraction_fingerprint, mutation_id, command_kind,
                 command_digest, resulting_version, item_count, applied_at
               ) VALUES (?, ?, 'correction', ?, ?, ?, ?)`
            )
            .bind(
              row.extraction_fingerprint,
              command.mutationId,
              command.commandDigest,
              resultingReviewVersion,
              command.request.answers.length,
              command.answeredAt
            ),
        ])
      )
    );
    const recorded = yield* readAnswerReplay(binding, command);
    if (Option.isSome(recorded)) {
      return recorded.value;
    }
    if (Exit.isFailure(applied)) {
      const current = yield* Effect.exit(
        requireCurrentAnswerState(binding, command)
      );
      if (Exit.isFailure(current)) {
        return yield* Effect.fail(
          Option.getOrThrow(Cause.findErrorOption(current.cause))
        );
      }
      return yield* Effect.fail(importPersistenceUnavailable());
    }
    return yield* Effect.fail(importPersistenceCorrupt());
  });

const confirmAction = (
  binding: AnyD1Database,
  command: ConfirmRecipeImportActionCommand
) =>
  Effect.gen(function* confirmRecipeImportAction() {
    const replay = yield* readConfirmReplay(binding, command);
    if (Option.isSome(replay)) {
      return replay.value;
    }
    const { review, row } = yield* requireCurrentAnswerState(binding, command);
    const blockers = approvalBlockers(review.draft, review.corrections);
    if (
      review.tags === null ||
      blockers.invalidFields.length > 0 ||
      blockers.unresolvedRequiredFields.length > 0
    ) {
      return yield* Effect.fail(new RecipeImportActionTransitionRejected());
    }
    const resultingReviewVersion = review.version + 1;
    const finalizingIntentVersion = row.intent_version + 1;
    const succeededIntentVersion = row.intent_version + 2;
    const applied = yield* Effect.exit(
      persistenceEffect(() =>
        binding.batch([
          binding
            .prepare(
              `UPDATE recipe_imports
                  SET public_status = 'processing',
                      public_stage = 'finalizing_recipe',
                      public_stage_started_at = ?, public_activity = 'working',
                      public_next_attempt_at = NULL, public_speech = NULL,
                      public_visuals = NULL, active_action_id = NULL,
                      active_action_version = NULL,
                      intent_version = intent_version + 1,
                      transition_mutation_id = ?, transition_command_digest = ?,
                      transition_actor_category = 'household_member',
                      transition_actor_identity_hash = ?,
                      transition_provenance_version = intent_version + 1,
                      updated_at = ?
                WHERE id = ? AND household_scope_id = ?
                  AND public_status = 'requires_action'
                  AND active_action_id = ? AND active_action_version = ?
                  AND intent_version = ?`
            )
            .bind(
              command.confirmedAt,
              command.mutationId,
              command.commandDigest,
              command.principal.actorId,
              command.confirmedAt,
              command.intentId,
              command.principal.householdScopeId,
              command.actionId,
              command.request.expectedActionVersion,
              row.intent_version
            ),
          binding
            .prepare(
              `UPDATE recipe_reviews
                  SET lifecycle = 'approved', version = version + 1,
                      updated_at = ?
                WHERE extraction_fingerprint = ? AND version = ?
                  AND lifecycle = 'needs_review'
                  AND tags_json IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM recipe_import_intent_history AS history
                     WHERE history.intent_id = ? AND history.intent_version = ?
                       AND history.mutation_id = ?
                       AND history.command_digest = ?
                       AND history.public_status = 'processing'
                       AND history.public_stage = 'finalizing_recipe'
                  )`
            )
            .bind(
              command.confirmedAt,
              row.extraction_fingerprint,
              review.version,
              command.intentId,
              finalizingIntentVersion,
              command.mutationId,
              command.commandDigest
            ),
          binding
            .prepare(
              `INSERT INTO recipe_review_transitions (
                 extraction_fingerprint, version, actor_id, from_lifecycle,
                 to_lifecycle, reason, transitioned_at
               )
               SELECT ?, ?, ?, 'needs_review', 'approved', ?, ?
                WHERE changes() = 1`
            )
            .bind(
              row.extraction_fingerprint,
              resultingReviewVersion,
              command.actorId,
              "Household confirmed recipe review action",
              command.confirmedAt
            ),
          binding
            .prepare(
              `UPDATE recipe_imports
                  SET public_status = 'succeeded', public_stage = NULL,
                      public_stage_started_at = NULL, public_activity = NULL,
                      public_next_attempt_at = NULL, public_recipe_id = id,
                      succeeded_at = ?, intent_version = intent_version + 1,
                      transition_mutation_id = ?, transition_command_digest = ?,
                      transition_actor_category = 'household_member',
                      transition_actor_identity_hash = ?,
                      transition_provenance_version = intent_version + 1,
                      updated_at = ?
                WHERE id = ? AND household_scope_id = ?
                  AND public_status = 'processing'
                  AND public_stage = 'finalizing_recipe'
                  AND intent_version = ?
                  AND EXISTS (
                    SELECT 1 FROM recipe_review_transitions AS transition
                     WHERE transition.extraction_fingerprint = ?
                       AND transition.version = ?
                       AND transition.from_lifecycle = 'needs_review'
                       AND transition.to_lifecycle = 'approved'
                  )`
            )
            .bind(
              command.confirmedAt,
              command.succeededMutationId,
              command.commandDigest,
              command.principal.actorId,
              command.confirmedAt,
              command.intentId,
              command.principal.householdScopeId,
              finalizingIntentVersion,
              row.extraction_fingerprint,
              resultingReviewVersion
            ),
          binding
            .prepare(
              `INSERT INTO recipe_review_mutations (
                 extraction_fingerprint, mutation_id, command_kind,
                 command_digest, resulting_version, item_count, applied_at
               ) VALUES (?, ?, 'transition', ?, ?, 1, ?)`
            )
            .bind(
              row.extraction_fingerprint,
              command.mutationId,
              command.commandDigest,
              resultingReviewVersion,
              command.confirmedAt
            ),
        ])
      )
    );
    const recorded = yield* readConfirmReplay(binding, command);
    if (Option.isSome(recorded)) {
      if (recorded.value.intentVersion !== succeededIntentVersion) {
        return yield* Effect.fail(importPersistenceCorrupt());
      }
      return recorded.value;
    }
    if (Exit.isFailure(applied)) {
      const current = yield* Effect.exit(
        requireCurrentAnswerState(binding, command)
      );
      if (Exit.isFailure(current)) {
        return yield* Effect.fail(
          Option.getOrThrow(Cause.findErrorOption(current.cause))
        );
      }
      return yield* Effect.fail(importPersistenceUnavailable());
    }
    return yield* Effect.fail(importPersistenceCorrupt());
  });

export const makeD1RecipeImportIntentReviewRepository = (
  binding: AnyD1Database
): RecipeImportIntentReviewRepository => ({
  answerAction: (command) =>
    answerAction(binding, command).pipe(
      Effect.tap(() =>
        Effect.annotateCurrentSpan({
          "recipeImport.actionId": command.actionId,
          "recipeImport.intentId": command.intentId,
          "recipeImport.mutationId": command.mutationId,
          "recipeImport.operation": "answer",
        })
      )
    ),
  confirmAction: (command) =>
    confirmAction(binding, command).pipe(
      Effect.tap(() =>
        Effect.annotateCurrentSpan({
          "recipeImport.actionId": command.actionId,
          "recipeImport.intentId": command.intentId,
          "recipeImport.mutationId": command.mutationId,
          "recipeImport.operation": "confirm",
        })
      )
    ),
  getAction: (principal, intentId, actionId) =>
    Effect.gen(function* getRecipeImportAction() {
      const source = yield* readActionSource(binding, principal, intentId);
      if (Option.isNone(source)) {
        return yield* Effect.fail(new RecipeImportActionNotFound());
      }
      const review = yield* requireReview(binding, intentId);
      if (
        source.value.public_status === "requires_action" &&
        source.value.active_action_id === actionId &&
        source.value.active_action_version !== null &&
        review._tag === "NeedsReview"
      ) {
        return projectActiveRecipeImportAction({
          actionId,
          actionVersion: Schema.decodeUnknownSync(RecipeImportActionVersion)(
            source.value.active_action_version
          ),
          intentId,
          review,
        });
      }
      if (source.value.public_status === "succeeded") {
        if (
          !(yield* actionBelongsToIntent(
            binding,
            principal,
            intentId,
            actionId
          ))
        ) {
          return yield* Effect.fail(new RecipeImportActionNotFound());
        }
        if (review._tag !== "Approved") {
          return yield* Effect.fail(importPersistenceCorrupt());
        }
        return projectCompletedRecipeImportAction({
          actionId,
          actionVersion: Schema.decodeUnknownSync(RecipeImportActionVersion)(
            review.version
          ),
          intentId,
          review,
        });
      }
      return yield* Effect.fail(new RecipeImportActionNotFound());
    }),
  getRecipe: (principal, recipeId) =>
    Effect.gen(function* getRecipeImportResult() {
      const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(recipeId);
      const intent = yield* makeD1ImportRepository(binding).findIntent(
        principal,
        intentId
      );
      if (Option.isNone(intent) || intent.value.status !== "succeeded") {
        return yield* Effect.fail(new RecipeImportRecipeNotFound());
      }
      if (intent.value.result.recipeId !== recipeId) {
        return yield* Effect.fail(importPersistenceCorrupt());
      }
      const review = yield* requireReview(binding, intentId);
      if (review._tag !== "Approved") {
        return yield* Effect.fail(importPersistenceCorrupt());
      }
      return projectPublicRecipe(
        Schema.decodeUnknownSync(RecipeId)(recipeId),
        review
      );
    }),
});
