import { HouseholdOrganizationId } from "@meal-planner/household-api";
import {
  RecipeId,
  RecipeImportActionVersion,
  RecipeImportIntentId,
  RequiresActionRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import type {
  RecipeImportAction,
  RecipeImportActionId,
  SucceededRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Option, Schema } from "effect";

import type {
  HouseholdAnswerRecipeReviewInput,
  HouseholdOpenRecipeReviewInput,
  HouseholdReadRecipeReviewInput,
  HouseholdRecipeReviewWire,
  HouseholdTransitionRecipeReviewInput,
} from "../households/household-recipe-bank.contract.js";
import {
  projectActiveRecipeImportAction,
  projectCompletedRecipeImportAction,
} from "./import-intent-review-action.js";
import type {
  AnswerRecipeImportActionCommand,
  ConfirmRecipeImportActionCommand,
  RecipeImportIntentReviewError,
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
import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import { RecipeReviewVersion, Review } from "./import-recipe-review.js";
import { EvidenceReference, ImportId } from "./import.contracts.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
} from "./import.errors.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";

export interface HouseholdRecipeReviewPort {
  readonly answerRecipeReview: (
    input: HouseholdAnswerRecipeReviewInput
  ) => Effect.Effect<HouseholdRecipeReviewWire, { readonly _tag: string }>;
  readonly openRecipeReview: (
    input: HouseholdOpenRecipeReviewInput
  ) => Effect.Effect<HouseholdRecipeReviewWire, { readonly _tag: string }>;
  readonly readRecipeReview: (
    input: HouseholdReadRecipeReviewInput
  ) => Effect.Effect<HouseholdRecipeReviewWire, { readonly _tag: string }>;
  readonly transitionRecipeReview: (
    input: HouseholdTransitionRecipeReviewInput
  ) => Effect.Effect<HouseholdRecipeReviewWire, { readonly _tag: string }>;
}

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Number);

const ActionSourceRow = Schema.Struct({
  active_action_id: NullableString,
  active_action_version: NullableNumber,
  completed_at: NullableString,
  draft_json: NullableString,
  evidence_references_json: Schema.String,
  intent_version: Schema.Number,
  public_status: Schema.String,
});
type ActionSourceRow = typeof ActionSourceRow.Type;

const AnswerReplayRow = Schema.Struct({
  action_id: NullableString,
  command_digest: Schema.String,
  created_at: Schema.String,
  intent_version: Schema.Number,
  occurred_at: Schema.String,
  public_source_url: NullableString,
});

const ConfirmReplayRow = Schema.Struct({
  action_id: NullableString,
  command_digest: Schema.String,
  event_type: Schema.String,
  public_stage: NullableString,
  public_status: Schema.String,
});
type ConfirmReplayRow = typeof ConfirmReplayRow.Type;

const persistenceEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: () => Promise.resolve(operation()),
  });

const asImportId = (intentId: RecipeImportIntentId) =>
  Schema.decodeUnknownSync(ImportId)(intentId);

const organizationIdFor = (principal: ImportPrincipal) =>
  Schema.decodeUnknownEffect(HouseholdOrganizationId)(
    (principal as ImportPrincipal & { readonly organizationId?: unknown })
      .organizationId
  ).pipe(Effect.mapError(() => importPersistenceCorrupt()));

const mapDomainFailure = (error: {
  readonly _tag: string;
}): RecipeImportIntentReviewError => {
  switch (error._tag) {
    case "RecipeReviewMutationConflict": {
      return new RecipeImportActionMutationConflict();
    }
    case "RecipeReviewTransitionRejected": {
      return new RecipeImportActionTransitionRejected();
    }
    case "RecipeReviewVersionConflict": {
      return new RecipeImportActionVersionConflict();
    }
    case "HouseholdInvalidInput":
    case "RecipeReviewNotFound":
    case "RecipeReviewOpenConflict": {
      return importPersistenceCorrupt();
    }
    default: {
      return importPersistenceUnavailable();
    }
  }
};

const decodeReview = (wire: HouseholdRecipeReviewWire) =>
  Schema.decodeUnknownEffect(Review)(wire).pipe(
    Effect.mapError(() => importPersistenceCorrupt())
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
                  extraction.completed_at, extraction.draft_json,
                  parent.evidence_references_json, parent.intent_version,
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
    return Option.some(
      yield* Schema.decodeUnknownEffect(ActionSourceRow, {
        onExcessProperty: "ignore",
      })(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()))
    );
  });

const openReview = (
  domain: HouseholdRecipeReviewPort,
  principal: ImportPrincipal,
  row: ActionSourceRow
) =>
  Effect.gen(function* openCurrentHouseholdRecipeReview() {
    if (row.completed_at === null || row.draft_json === null) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    const organizationId = yield* organizationIdFor(principal);
    const [draft, evidence] = yield* Effect.all([
      Schema.decodeUnknownEffect(Schema.fromJsonString(RecipeDraft))(
        row.draft_json
      ),
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Array(EvidenceReference))
      )(row.evidence_references_json),
    ]).pipe(Effect.mapError(() => importPersistenceCorrupt()));
    const [draftWire, evidenceWire] = yield* Effect.all([
      Schema.encodeEffect(RecipeDraft)(draft),
      Effect.all(
        evidence.map((reference) =>
          Schema.encodeEffect(EvidenceReference)(reference)
        )
      ),
    ]).pipe(Effect.mapError(() => importPersistenceCorrupt()));
    return yield* domain
      .openRecipeReview({
        openedAt: row.completed_at,
        organizationId,
        snapshot: { draft: draftWire, evidence: evidenceWire },
      })
      .pipe(Effect.mapError(mapDomainFailure), Effect.flatMap(decodeReview));
  });

const requireCurrentAction = (
  binding: AnyD1Database,
  domain: HouseholdRecipeReviewPort,
  command: AnswerRecipeImportActionCommand | ConfirmRecipeImportActionCommand
) =>
  Effect.gen(function* requireCurrentRecipeImportAction() {
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
    if (row.active_action_version !== command.request.expectedActionVersion) {
      return yield* Effect.fail(new RecipeImportActionVersionConflict());
    }
    return { review: yield* openReview(domain, command.principal, row), row };
  });

const priorReviewVersion = (actionVersion: number) =>
  Schema.decodeUnknownEffect(RecipeReviewVersion)(actionVersion - 1).pipe(
    Effect.mapError(() => importPersistenceCorrupt())
  );

const readAnswerReplay = (
  binding: AnyD1Database,
  command: AnswerRecipeImportActionCommand
) =>
  Effect.gen(function* readAnswerActionReplay() {
    const raw = yield* persistenceEffect(() =>
      binding
        .prepare(
          `SELECT history.action_id, history.command_digest, parent.created_at,
                  history.intent_version, history.occurred_at,
                  parent.public_source_url
             FROM recipe_imports AS parent
             JOIN recipe_import_intent_history AS history
               ON history.intent_id = parent.id AND history.mutation_id = ?
            WHERE parent.household_scope_id = ? AND parent.id = ?
            LIMIT 1`
        )
        .bind(
          command.mutationId,
          command.principal.householdScopeId,
          command.intentId
        )
        .first()
    );
    if (raw === null) {
      return Option.none<typeof RequiresActionRecipeImportIntent.Type>();
    }
    const row = yield* Schema.decodeUnknownEffect(AnswerReplayRow, {
      onExcessProperty: "ignore",
    })(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()));
    if (row.command_digest !== command.commandDigest) {
      return yield* Effect.fail(new RecipeImportActionMutationConflict());
    }
    if (row.action_id !== command.actionId || row.public_source_url === null) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    return Option.some(
      Schema.decodeUnknownSync(RequiresActionRecipeImportIntent)({
        action: {
          id: command.actionId,
          link: `/v1/recipe-import-intents/${command.intentId}/actions/${command.actionId}`,
          type: "review_recipe",
        },
        createdAt: row.created_at,
        id: command.intentId,
        intentVersion: row.intent_version,
        links: {
          self: `/v1/recipe-import-intents/${command.intentId}`,
          timeline: `/v1/recipe-import-intents/${command.intentId}/timeline`,
        },
        object: "recipe_import_intent",
        source: {
          canonicalUrl: row.public_source_url,
          kind: "tiktok",
          resolution: "resolved",
        },
        status: "requires_action",
        updatedAt: row.occurred_at,
      })
    );
  });

const readConfirmReplay = (
  binding: AnyD1Database,
  command: ConfirmRecipeImportActionCommand
) =>
  Effect.gen(function* readConfirmActionReplay() {
    const raw = yield* persistenceEffect(() =>
      binding
        .prepare(
          `SELECT history.command_digest, history.event_type,
                  history.public_stage, parent.public_status,
                  (
                    SELECT available.action_id
                      FROM recipe_import_intent_history AS available
                     WHERE available.intent_id = parent.id
                       AND available.event_type = 'action_available'
                       AND available.intent_version < history.intent_version
                     ORDER BY available.intent_version DESC LIMIT 1
                  ) AS action_id
             FROM recipe_imports AS parent
             JOIN recipe_import_intent_history AS history
               ON history.intent_id = parent.id AND history.mutation_id = ?
            WHERE parent.household_scope_id = ? AND parent.id = ?
            LIMIT 1`
        )
        .bind(
          command.mutationId,
          command.principal.householdScopeId,
          command.intentId
        )
        .first()
    );
    if (raw === null) {
      return Option.none<ConfirmReplayRow>();
    }
    const row = yield* Schema.decodeUnknownEffect(ConfirmReplayRow, {
      onExcessProperty: "ignore",
    })(raw).pipe(Effect.mapError(() => importPersistenceCorrupt()));
    if (row.command_digest !== command.commandDigest) {
      return yield* Effect.fail(new RecipeImportActionMutationConflict());
    }
    if (
      row.action_id !== command.actionId ||
      row.event_type !== "processing_stage_changed" ||
      row.public_stage !== "finalizing_recipe"
    ) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    return Option.some(row);
  });

const answerAction = (
  binding: AnyD1Database,
  domain: HouseholdRecipeReviewPort,
  command: AnswerRecipeImportActionCommand
): Effect.Effect<
  typeof RequiresActionRecipeImportIntent.Type,
  RecipeImportIntentReviewError
> =>
  Effect.gen(function* answerRecipeImportAction() {
    const replay = yield* readAnswerReplay(binding, command);
    if (Option.isSome(replay)) {
      return replay.value;
    }
    const { review, row } = yield* requireCurrentAction(
      binding,
      domain,
      command
    );
    if (review._tag !== "NeedsReview") {
      return yield* Effect.fail(new RecipeImportActionTransitionRejected());
    }
    const organizationId = yield* organizationIdFor(command.principal);
    const expectedVersion = yield* priorReviewVersion(
      command.request.expectedActionVersion
    );
    yield* domain
      .answerRecipeReview({
        actorId: command.actorId,
        answeredAt: command.answeredAt,
        answers: command.request.answers,
        expectedVersion,
        importId: asImportId(command.intentId),
        mutationId: command.mutationId,
        organizationId,
      })
      .pipe(Effect.mapError(mapDomainFailure));
    yield* persistenceEffect(() =>
      binding
        .prepare(
          `UPDATE recipe_imports
              SET active_action_version = active_action_version + 1,
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
          command.mutationId,
          command.commandDigest,
          command.principal.actorId,
          command.answeredAt,
          command.intentId,
          command.principal.householdScopeId,
          command.actionId,
          command.request.expectedActionVersion,
          row.intent_version
        )
        .run()
    );
    const recorded = yield* readAnswerReplay(binding, command);
    if (Option.isNone(recorded)) {
      return yield* Effect.fail(importPersistenceUnavailable());
    }
    return recorded.value;
  });

const finishConfirmedIntent = (
  binding: AnyD1Database,
  command: ConfirmRecipeImportActionCommand
): Effect.Effect<SucceededRecipeImportIntent, RecipeImportIntentReviewError> =>
  Effect.gen(function* finishConfirmedRecipeImportIntent() {
    yield* persistenceEffect(() =>
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
              AND public_stage = 'finalizing_recipe'`
        )
        .bind(
          command.confirmedAt,
          command.succeededMutationId,
          command.commandDigest,
          command.principal.actorId,
          command.confirmedAt,
          command.intentId,
          command.principal.householdScopeId
        )
        .run()
    );
    const intent = yield* makeD1ImportRepository(binding).findIntent(
      command.principal,
      command.intentId
    );
    if (Option.isNone(intent) || intent.value.status !== "succeeded") {
      return yield* Effect.fail(importPersistenceUnavailable());
    }
    return intent.value;
  });

const confirmAction = (
  binding: AnyD1Database,
  domain: HouseholdRecipeReviewPort,
  command: ConfirmRecipeImportActionCommand
): Effect.Effect<SucceededRecipeImportIntent, RecipeImportIntentReviewError> =>
  Effect.gen(function* confirmRecipeImportAction() {
    const replay = yield* readConfirmReplay(binding, command);
    if (Option.isSome(replay)) {
      return yield* finishConfirmedIntent(binding, command);
    }
    const { row } = yield* requireCurrentAction(binding, domain, command);
    const organizationId = yield* organizationIdFor(command.principal);
    const expectedVersion = yield* priorReviewVersion(
      command.request.expectedActionVersion
    );
    yield* domain
      .transitionRecipeReview({
        actorId: command.actorId,
        expectedVersion,
        importId: asImportId(command.intentId),
        mutationId: command.mutationId,
        organizationId,
        reason: "Household confirmed recipe review action",
        to: "approved",
        transitionedAt: command.confirmedAt,
      })
      .pipe(Effect.mapError(mapDomainFailure));
    yield* persistenceEffect(() =>
      binding
        .prepare(
          `UPDATE recipe_imports
              SET public_status = 'processing', public_stage = 'finalizing_recipe',
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
        )
        .run()
    );
    if (Option.isNone(yield* readConfirmReplay(binding, command))) {
      return yield* Effect.fail(importPersistenceUnavailable());
    }
    return yield* finishConfirmedIntent(binding, command);
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
        `SELECT 1 FROM recipe_imports AS parent
          JOIN recipe_import_intent_history AS history
            ON history.intent_id = parent.id
         WHERE parent.household_scope_id = ? AND parent.id = ?
           AND history.event_type = 'action_available'
           AND history.action_id = ? LIMIT 1`
      )
      .bind(principal.householdScopeId, intentId, actionId)
      .first()
  ).pipe(Effect.map((row) => row !== null));

const readReview = (
  domain: HouseholdRecipeReviewPort,
  principal: ImportPrincipal,
  intentId: RecipeImportIntentId
) =>
  Effect.gen(function* readHouseholdRecipeReview() {
    const organizationId = yield* organizationIdFor(principal);
    return yield* domain
      .readRecipeReview({
        importId: asImportId(intentId),
        organizationId,
      })
      .pipe(Effect.mapError(mapDomainFailure), Effect.flatMap(decodeReview));
  });

export const makeRecipeImportIntentReviewRepository = (
  binding: AnyD1Database,
  domain: HouseholdRecipeReviewPort
): RecipeImportIntentReviewRepository => ({
  answerAction: (command) => answerAction(binding, domain, command),
  confirmAction: (command) => confirmAction(binding, domain, command),
  getAction: (
    principal,
    intentId,
    actionId
  ): Effect.Effect<RecipeImportAction, RecipeImportIntentReviewError> =>
    Effect.gen(function* getRecipeImportAction() {
      const source = yield* readActionSource(binding, principal, intentId);
      if (Option.isNone(source)) {
        return yield* Effect.fail(new RecipeImportActionNotFound());
      }
      const review = yield* openReview(domain, principal, source.value);
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
      if (
        source.value.public_status === "succeeded" &&
        (yield* actionBelongsToIntent(
          binding,
          principal,
          intentId,
          actionId
        )) &&
        review._tag === "Approved"
      ) {
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
      const review = yield* readReview(domain, principal, intentId);
      if (review._tag !== "Approved") {
        return yield* Effect.fail(importPersistenceCorrupt());
      }
      return projectPublicRecipe(
        Schema.decodeUnknownSync(RecipeId)(recipeId),
        review
      );
    }),
});
