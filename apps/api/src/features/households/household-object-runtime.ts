import {
  PersonProfile,
  ProfileVersionPage,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureStart,
  HouseholdPeopleRoster,
  HouseholdPerson,
  MealPlan,
  MealPlanPolicy,
  MealPlanRecipeSnapshot,
  MealPlanRequest,
} from "@meal-planner/household-api";
import {
  CancelledRecipeImportIntent,
  Recipe,
  RecipeImportBatch,
  RecipeImportAction,
  RecipeImportIntent,
  RecipeImportTimeline,
  SucceededRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Clock, Effect, Option, Schema } from "effect";

import migrations from "../../../household-migrations/migrations.js";
import {
  addMealPlanCandidatePage,
  makeDeterministicMealPlanPlanner,
  makeMealPlanCandidateFrontier,
  makeMealPlanService,
  MealPlanRecipeAuthorityToken,
  selectMealPlanCandidates,
} from "../meal-planning/meal-plan.js";
import { HouseholdImportBatchQueueWriter } from "./batches/household-import-batch-queue.port.js";
import {
  HouseholdAdmitImportBatchInput,
  HouseholdAdmitImportBatchResult,
  HouseholdClaimImportBatchItemInput,
  HouseholdClaimImportBatchItemResult,
  HouseholdCompleteImportBatchItemInput,
  HouseholdFailImportBatchItemInput,
  HouseholdReadImportBatchInput,
  HouseholdRecordImportBatchDispatchInput,
} from "./batches/household-import-batch.contract.js";
import { makeHouseholdImportBatchRepository } from "./batches/household-import-batch.repository.js";
import {
  HouseholdCommitAcquisitionEvidenceInput,
  HouseholdCommitAcquisitionEvidenceResult,
  HouseholdClaimAcquisitionAttemptInput,
  HouseholdClaimAcquisitionAttemptResult,
  HouseholdMutateEvidenceStageInput,
  HouseholdMutateEvidenceStageResult,
  HouseholdObserveEvidenceReferenceInput,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdPrepareRecipeRecoveryInput,
  HouseholdPrepareRecipeRecoveryResult,
  HouseholdReadEvidenceReferencesInput,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadAcquisitionAttemptsInput,
  HouseholdReadAcquisitionAttemptsResult,
  HouseholdReadEvidenceStageInput,
  HouseholdReadEvidenceStageResult,
  HouseholdReadImportTerminalCheckpointInput,
  HouseholdReadImportTerminalCheckpointResult,
  HouseholdReadRecipeRecoveryAttemptInput,
  HouseholdReadRecipeRecoveryAttemptResult,
} from "./evidence/household-evidence.contract.js";
import { makeHouseholdEvidenceRepository } from "./evidence/household-evidence.repository.js";
import { ensureHouseholdProvenance } from "./foundation/household-provenance.js";
import { makeImportWorkflowAdmissionRepository } from "./foundation/import-workflow-admission.repository.js";
import {
  admitManualMealSwap,
  admitMealPlanDecision,
} from "./household-meal-plan-admission.js";
import {
  HouseholdCreateMealPlanInput,
  HouseholdCreateMealPlanFromRecipeBankInput,
  HouseholdDecideMealPlanInput,
  HouseholdManualMealSwapCommand,
  HouseholdMealPlanDecisionCommand,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanInput,
  HouseholdSwapMealPlanFromRecipeBankInput,
} from "./household-meal-plan.contract.js";
import { makeHouseholdMealPlanRepository } from "./household-meal-plan.repository.js";
import {
  HouseholdEnsureInput,
  HouseholdInvalidInput,
} from "./household.contract.js";
import {
  HouseholdAssociateAdultInvitationInput,
  HouseholdBootstrapCreatorPersonInput,
  HouseholdCancelMemberDepartureInput,
  HouseholdCompleteAcceptedAdultLinkInput,
  HouseholdConfirmAdultInvitationRecipientInput,
  HouseholdConfirmMemberAccessRevokedInput,
  HouseholdCreatePersonInput,
  HouseholdFinalizeMemberDepartureInput,
  HouseholdGetMemberDepartureByMutationInput,
  HouseholdGetMemberDepartureInput,
  HouseholdGetPersonInput,
  HouseholdListPeopleInput,
  HouseholdMarkMemberDepartureRepairRequiredInput,
  HouseholdMemberDepartureSystemState,
  HouseholdPrepareMemberDepartureInput,
  HouseholdReadMemberDepartureSystemInput,
  HouseholdRepairAdultAccountLinkInput,
  HouseholdRestoreReturningAdultLinkInput,
  HouseholdRetryMemberDepartureInput,
  HouseholdStartMemberDepartureInput,
  HouseholdTransitionPersonInput,
} from "./people/household-people.contract.js";
import { makeHouseholdPeopleRepository } from "./people/household-people.repository.js";
import {
  HouseholdReadPersonProfileInput,
  HouseholdListProfileVersionsInput,
  HouseholdMutatePersonProfileInput,
} from "./profiles/household-profile.contract.js";
import { makeHouseholdProfileRepository } from "./profiles/household-profile.repository.js";
import {
  HouseholdAdmitRecipeImportInput,
  HouseholdAdmitRecipeImportResult,
  HouseholdActiveRecipeImportActionResult,
  HouseholdAnswerRecipeImportActionInput,
  HouseholdCancelRecipeImportInput,
  HouseholdCommitRecipeImportDraftInput,
  HouseholdConfirmRecipeImportActionInput,
  HouseholdReadRecipeImportActionInput,
  HouseholdReadRecipeImportExecutionInput,
  HouseholdReadRecipeImportInput,
  HouseholdReadRecipeInput,
  HouseholdRecordRecipeImportDispatchInput,
  HouseholdRecordRecipeImportDispatchResult,
  HouseholdRecipeImportExecutionView,
  HouseholdRecipeImportFailure,
  householdRecipePlanningPageByteLimit,
  HouseholdRecipePage,
  HouseholdRecipePageInput,
  HouseholdResolveRecipeImportSourceInput,
  HouseholdTransitionRecipeImportLifecycleInput,
} from "./recipe-import/household-recipe-import.contract.js";
import type { HouseholdRecipePageCursor } from "./recipe-import/household-recipe-import.contract.js";
import { makeHouseholdRecipeImportRepository } from "./recipe-import/household-recipe-import.repository.js";
import { requireHouseholdCommandAdmission } from "./rpc/command-envelope.js";
import {
  HouseholdCanonicalEncoding,
  HouseholdDigest,
  HouseholdIdentityGenerator,
} from "./shared-kernel/authority-services.js";

const invalidInput = () => HouseholdInvalidInput.make({});

const encodeMealPlan = (plan: typeof MealPlan.Type) =>
  Schema.encodeEffect(MealPlan)(plan).pipe(Effect.mapError(invalidInput));

const encodeRecipeImportResult = <S extends Schema.Top>(
  schema: S,
  value: S["Type"]
) => Schema.encodeEffect(schema)(value).pipe(Effect.mapError(invalidInput));

const encodePeopleResult = <S extends Schema.Top>(
  schema: S,
  value: S["Type"]
) => Schema.encodeEffect(schema)(value).pipe(Effect.mapError(invalidInput));

const makeService = (
  database: EffectSQLiteDoDatabase,
  digest: Effect.Success<typeof HouseholdDigest>,
  approvedRecipes: readonly MealPlanRecipeSnapshot[] = []
) =>
  makeMealPlanService({
    drafts: makeHouseholdMealPlanRepository(database, digest),
    planner: makeDeterministicMealPlanPlanner(),
    recipeReviews: {
      listApproved: () => Effect.succeed(approvedRecipes),
    },
  });

const decodeApprovedRecipes = (
  encoded: HouseholdCreateMealPlanInput["approvedRecipes"]
) =>
  Effect.all(
    encoded.map((recipe) =>
      Schema.decodeUnknownEffect(MealPlanRecipeSnapshot)(recipe).pipe(
        Effect.mapError(invalidInput)
      )
    )
  );

export const HouseholdObjectRuntime = Effect.gen(
  function* initializeHouseholdObject() {
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    const canonicalEncoding = yield* HouseholdCanonicalEncoding;
    const digest = yield* HouseholdDigest;
    const identityGenerator = yield* HouseholdIdentityGenerator;
    const batchQueueWriter = yield* HouseholdImportBatchQueueWriter;
    const scoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(HouseholdCanonicalEncoding, canonicalEncoding),
        Effect.provideService(HouseholdDigest, digest),
        Effect.provideService(HouseholdIdentityGenerator, identityGenerator),
        Effect.provideService(
          Cloudflare.DurableObjectState,
          durableObjectState
        ),
        Effect.scoped
      );
    const database = Drizzle.DurableObject({ migrations });

    // eslint-disable-next-line sort-keys -- RPC methods follow the household capability lifecycle.
    return Effect.succeed({
      associateAdultInvitation: (
        untrustedInput: HouseholdAssociateAdultInvitationInput
      ) =>
        scoped(
          Effect.gen(function* associateAdultInvitation() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdAssociateAdultInvitationInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "associate_adult_invitation"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const person = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).associateAdultInvitation({
              actorId: command.admission.actor.actorId,
              linkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
            });
            return yield* encodePeopleResult(HouseholdPerson, person);
          })
        ),
      archiveHouseholdPerson: (
        untrustedInput: HouseholdTransitionPersonInput
      ) =>
        scoped(
          Effect.gen(function* archiveHouseholdPerson() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdTransitionPersonInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "archive_household_person"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const person = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).archive({
              actorId: command.admission.actor.actorId,
              linkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
              personId: command.personId,
            });
            return yield* encodePeopleResult(HouseholdPerson, person);
          })
        ),
      admitImportBatch: (untrustedInput: HouseholdAdmitImportBatchInput) =>
        scoped(
          Effect.gen(function* admitHouseholdImportBatch() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdAdmitImportBatchInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "admit_import_batch"
            );
            const connection = yield* database;
            const committed =
              yield* makeHouseholdImportBatchRepository(connection).admit(
                command
              );
            if (committed.messages.length > 0) {
              yield* durableObjectState.storage.setAlarm(
                yield* Clock.currentTimeMillis
              );
            }
            return yield* encodeRecipeImportResult(
              HouseholdAdmitImportBatchResult,
              committed
            );
          })
        ),
      admitRecipeImport: (untrustedInput: HouseholdAdmitRecipeImportInput) =>
        scoped(
          Effect.gen(function* admitHouseholdRecipeImport() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdAdmitRecipeImportInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "admit_recipe_import"
            );
            const connection = yield* database;
            const committed =
              yield* makeHouseholdRecipeImportRepository(connection).admit(
                command
              );
            return yield* encodeRecipeImportResult(
              HouseholdAdmitRecipeImportResult,
              committed
            );
          })
        ),
      bootstrapCreatorPerson: (
        untrustedInput: HouseholdBootstrapCreatorPersonInput
      ) =>
        scoped(
          Effect.gen(function* bootstrapCreatorPerson() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdBootstrapCreatorPersonInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "bootstrap_creator_person"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const person = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).bootstrapCreator({
              actorId: command.admission.actor.actorId,
              linkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
            });
            return yield* encodePeopleResult(HouseholdPerson, person);
          })
        ),
      answerRecipeImportAction: (
        untrustedInput: HouseholdAnswerRecipeImportActionInput
      ) =>
        scoped(
          Effect.gen(function* answerHouseholdRecipeImportAction() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdAnswerRecipeImportActionInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "answer_recipe_import_action"
            );
            const connection = yield* database;
            const answered =
              yield* makeHouseholdRecipeImportRepository(connection).answer(
                command
              );
            return yield* encodeRecipeImportResult(
              RecipeImportIntent,
              answered
            );
          })
        ),
      alarm: () =>
        scoped(
          Effect.gen(function* dispatchHouseholdBatchOutbox() {
            const connection = yield* database;
            const repository = makeHouseholdImportBatchRepository(connection);
            const due = yield* repository.dueDispatches(
              yield* Clock.currentTimeMillis
            );
            for (const { message } of due) {
              const admission = {
                actor: {
                  _tag: "System" as const,
                  purpose: "batch_item_dispatch" as const,
                },
                organizationId: message.organizationId,
              };
              const outcome = yield* batchQueueWriter.send(message).pipe(
                Effect.match({
                  onFailure: () => "retry" as const,
                  onSuccess: () => "delivered" as const,
                })
              );
              yield* repository.recordDispatch({
                admission,
                batchId: message.batchId,
                expectedGeneration: message.generation,
                itemId: message.itemId,
                outcome,
              });
            }
            const next = yield* repository.nextDispatchAt;
            yield* next === null
              ? durableObjectState.storage.deleteAlarm()
              : durableObjectState.storage.setAlarm(next);
          })
        ),
      claimImportBatchItem: (
        untrustedInput: HouseholdClaimImportBatchItemInput
      ) =>
        scoped(
          Effect.gen(function* claimHouseholdImportBatchItem() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdClaimImportBatchItemInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "claim_import_batch_item"
            );
            const connection = yield* database;
            const result =
              yield* makeHouseholdImportBatchRepository(connection).claim(
                command
              );
            return yield* encodeRecipeImportResult(
              HouseholdClaimImportBatchItemResult,
              result
            );
          })
        ),
      completeImportBatchItem: (
        untrustedInput: HouseholdCompleteImportBatchItemInput
      ) =>
        scoped(
          Effect.gen(function* completeHouseholdImportBatchItem() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCompleteImportBatchItemInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "complete_import_batch_item"
            );
            const connection = yield* database;
            return yield* makeHouseholdImportBatchRepository(connection)
              .complete(command)
              .pipe(
                Effect.flatMap((batch) =>
                  encodeRecipeImportResult(RecipeImportBatch, batch)
                )
              );
          })
        ),
      failImportBatchItem: (
        untrustedInput: HouseholdFailImportBatchItemInput
      ) =>
        scoped(
          Effect.gen(function* failHouseholdImportBatchItem() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdFailImportBatchItemInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "fail_import_batch_item"
            );
            const connection = yield* database;
            return yield* makeHouseholdImportBatchRepository(connection)
              .fail(command)
              .pipe(
                Effect.flatMap((batch) =>
                  encodeRecipeImportResult(RecipeImportBatch, batch)
                )
              );
          })
        ),
      approveMealPlan: (untrustedInput: HouseholdDecideMealPlanInput) =>
        scoped(
          Effect.gen(function* approveHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdDecideMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "approve_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const admittedCommand = yield* Schema.decodeUnknownEffect(
              HouseholdMealPlanDecisionCommand
            )(command.request).pipe(Effect.mapError(invalidInput));
            const request = yield* admitMealPlanDecision(
              command.admission,
              admittedCommand
            ).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(connection, digest).approve(
              request
            );
            return yield* encodeMealPlan(plan);
          })
        ),
      createMealPlan: (untrustedInput: HouseholdCreateMealPlanInput) =>
        scoped(
          Effect.gen(function* createHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCreateMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "create_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const approvedRecipes = yield* decodeApprovedRecipes(
              command.approvedRecipes
            );
            const policy = yield* Schema.decodeUnknownEffect(MealPlanPolicy)(
              command.policy
            ).pipe(Effect.mapError(invalidInput));
            const request = yield* Schema.decodeUnknownEffect(MealPlanRequest)(
              command.request
            ).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(
              connection,
              digest,
              approvedRecipes
            ).create(request, policy);
            return yield* encodeMealPlan(plan);
          })
        ),
      createHouseholdPerson: (untrustedInput: HouseholdCreatePersonInput) =>
        scoped(
          Effect.gen(function* createHouseholdPerson() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCreatePersonInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "create_household_person"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const person = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).create({
              actorId: command.admission.actor.actorId,
              linkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
            });
            return yield* encodePeopleResult(HouseholdPerson, person);
          })
        ),
      createMealPlanFromRecipeBank: (
        untrustedInput: HouseholdCreateMealPlanFromRecipeBankInput
      ) =>
        scoped(
          Effect.gen(function* createMealPlanFromHouseholdRecipeBank() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCreateMealPlanFromRecipeBankInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "create_meal_plan_from_recipe_bank"
            );
            const connection = yield* database;
            const recipes = makeHouseholdRecipeImportRepository(connection);
            const policy = yield* Schema.decodeUnknownEffect(MealPlanPolicy)(
              command.policy
            ).pipe(Effect.mapError(invalidInput));
            const request = yield* Schema.decodeUnknownEffect(MealPlanRequest)(
              command.request
            ).pipe(Effect.mapError(invalidInput));
            let frontier = makeMealPlanCandidateFrontier({ policy, request });
            let cursor: typeof HouseholdRecipePageCursor.Type | null = null;
            do {
              const page: typeof HouseholdRecipePage.Type =
                yield* recipes.listRecipePage({
                  admission: command.admission,
                  byteLimit: householdRecipePlanningPageByteLimit,
                  cursor,
                  limit: 100,
                });
              const candidates = yield* Effect.forEach(
                (recipe: (typeof page.items)[number]) =>
                  canonicalEncoding.encode(recipe.tags).pipe(
                    Effect.flatMap(digest.sha256),
                    Effect.mapError(invalidInput),
                    Effect.flatMap((tagsFingerprint) =>
                      Schema.decodeUnknownEffect(MealPlanRecipeAuthorityToken)({
                        extractionFingerprint: recipe.extractionFingerprint,
                        reviewVersion: recipe.version,
                        tagsFingerprint,
                      })
                    ),
                    Effect.mapError(invalidInput),
                    Effect.map((authorityToken) => ({
                      authorityToken,
                      importId: recipe.importId,
                      tags: recipe.tags,
                    }))
                  )
              )(page.items);
              frontier = addMealPlanCandidatePage(frontier, candidates);
              cursor = page.nextCursor;
            } while (cursor !== null);
            const selectedImportIds = [
              ...new Set(
                selectMealPlanCandidates(frontier).assignments.map(
                  ({ importId }) => importId
                )
              ),
            ];
            const selectedRecipes = yield* Effect.forEach(
              (importId: (typeof selectedImportIds)[number]) =>
                recipes.readPlanningRecipe(command.admission, importId)
            )(selectedImportIds);
            const plan = yield* makeService(
              connection,
              digest,
              selectedRecipes
            ).create(request, policy);
            return yield* encodeMealPlan(plan);
          })
        ),
      cancelRecipeImport: (untrustedInput: HouseholdCancelRecipeImportInput) =>
        scoped(
          Effect.gen(function* cancelHouseholdRecipeImport() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCancelRecipeImportInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "cancel_recipe_import"
            );
            const connection = yield* database;
            const cancelled =
              yield* makeHouseholdRecipeImportRepository(connection).cancel(
                command
              );
            return yield* encodeRecipeImportResult(
              CancelledRecipeImportIntent,
              cancelled
            );
          })
        ),
      commitAcquisitionEvidence: (
        untrustedInput: typeof HouseholdCommitAcquisitionEvidenceInput.Encoded
      ) =>
        scoped(
          Effect.gen(function* commitHouseholdAcquisitionEvidence() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCommitAcquisitionEvidenceInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "commit_acquisition_evidence"
            );
            const connection = yield* database;
            const committed =
              yield* makeHouseholdEvidenceRepository(
                connection
              ).commitAcquisition(command);
            return yield* encodeRecipeImportResult(
              HouseholdCommitAcquisitionEvidenceResult,
              committed
            );
          })
        ),
      claimAcquisitionAttempt: (
        untrustedInput: typeof HouseholdClaimAcquisitionAttemptInput.Encoded
      ) =>
        scoped(
          Effect.gen(function* claimHouseholdAcquisitionAttempt() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdClaimAcquisitionAttemptInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "claim_acquisition_attempt"
            );
            const connection = yield* database;
            const claimed =
              yield* makeHouseholdEvidenceRepository(
                connection
              ).claimAcquisitionAttempt(command);
            return yield* encodeRecipeImportResult(
              HouseholdClaimAcquisitionAttemptResult,
              claimed
            );
          })
        ),
      mutateEvidenceStage: (
        untrustedInput: typeof HouseholdMutateEvidenceStageInput.Encoded
      ) =>
        scoped(
          Effect.gen(function* mutateHouseholdEvidenceStage() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdMutateEvidenceStageInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "mutate_evidence_stage"
            );
            const connection = yield* database;
            const committed =
              yield* makeHouseholdEvidenceRepository(connection).mutateStage(
                command
              );
            return yield* encodeRecipeImportResult(
              HouseholdMutateEvidenceStageResult,
              committed
            );
          })
        ),
      commitRecipeImportDraft: (
        untrustedInput: HouseholdCommitRecipeImportDraftInput
      ) =>
        scoped(
          Effect.gen(function* commitHouseholdRecipeImportDraft() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCommitRecipeImportDraftInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "commit_recipe_import_draft"
            );
            const connection = yield* database;
            const committed =
              yield* makeHouseholdRecipeImportRepository(
                connection
              ).commitDraft(command);
            return yield* encodeRecipeImportResult(
              HouseholdActiveRecipeImportActionResult,
              committed
            );
          })
        ),
      observeEvidenceReference: (
        untrustedInput: typeof HouseholdObserveEvidenceReferenceInput.Encoded
      ) =>
        scoped(
          Effect.gen(function* observeHouseholdEvidenceReference() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdObserveEvidenceReferenceInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "observe_evidence_reference"
            );
            const connection = yield* database;
            const committed =
              yield* makeHouseholdEvidenceRepository(
                connection
              ).observeReference(command);
            return yield* encodeRecipeImportResult(
              HouseholdObserveEvidenceReferenceResult,
              committed
            );
          })
        ),
      prepareRecipeRecovery: (
        untrustedInput: typeof HouseholdPrepareRecipeRecoveryInput.Encoded
      ) =>
        scoped(
          Effect.gen(function* prepareHouseholdRecipeRecovery() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdPrepareRecipeRecoveryInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "prepare_recipe_recovery"
            );
            const connection = yield* database;
            const prepared =
              yield* makeHouseholdEvidenceRepository(
                connection
              ).prepareRecipeRecovery(command);
            return yield* encodeRecipeImportResult(
              HouseholdPrepareRecipeRecoveryResult,
              prepared
            );
          })
        ),
      confirmRecipeImportAction: (
        untrustedInput: HouseholdConfirmRecipeImportActionInput
      ) =>
        scoped(
          Effect.gen(function* confirmHouseholdRecipeImportAction() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdConfirmRecipeImportActionInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "confirm_recipe_import_action"
            );
            const connection = yield* database;
            const confirmed =
              yield* makeHouseholdRecipeImportRepository(connection).confirm(
                command
              );
            return yield* encodeRecipeImportResult(
              SucceededRecipeImportIntent,
              confirmed
            );
          })
        ),
      completeAcceptedAdultLink: (
        untrustedInput: HouseholdCompleteAcceptedAdultLinkInput
      ) =>
        scoped(
          Effect.gen(function* completeAcceptedAdultLink() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCompleteAcceptedAdultLinkInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "complete_accepted_adult_link"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const person = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).completeAcceptedAdultLink({
              actorId: command.admission.actor.actorId,
              linkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
            });
            return yield* encodePeopleResult(HouseholdPerson, person);
          })
        ),
      confirmAdultInvitationRecipient: (
        untrustedInput: HouseholdConfirmAdultInvitationRecipientInput
      ) =>
        scoped(
          Effect.gen(function* confirmAdultInvitationRecipient() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdConfirmAdultInvitationRecipientInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "confirm_adult_invitation_recipient"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).confirmAdultInvitationRecipient({
              invitationDigest: command.invitationDigest,
              linkageSubject: command.linkageSubject,
            });
          })
        ),
      cancelMemberDeparture: (
        untrustedInput: HouseholdCancelMemberDepartureInput
      ) =>
        scoped(
          Effect.gen(function* cancelMemberDeparture() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdCancelMemberDepartureInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "cancel_member_departure"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const operation = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).cancelMemberDeparture({
              actorId: command.admission.actor.actorId,
              callerIsOwner: command.admission.actor._tag === "PeopleCreator",
              callerLinkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              operationId: command.operationId,
              payload: command.payload,
            });
            return yield* encodePeopleResult(
              HouseholdMemberDepartureOperation,
              operation
            );
          })
        ),
      confirmMemberAccessRevoked: (
        untrustedInput: HouseholdConfirmMemberAccessRevokedInput
      ) =>
        scoped(
          Effect.gen(function* confirmMemberAccessRevoked() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdConfirmMemberAccessRevokedInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "confirm_member_access_revoked"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const operation = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).confirmMemberAccessRevoked({
              expectedOperationVersion: command.expectedOperationVersion,
              now: yield* Clock.currentTimeMillis,
              operationId: command.operationId,
            });
            return yield* encodePeopleResult(
              HouseholdMemberDepartureOperation,
              operation
            );
          })
        ),
      finalizeMemberDeparture: (
        untrustedInput: HouseholdFinalizeMemberDepartureInput
      ) =>
        scoped(
          Effect.gen(function* finalizeMemberDeparture() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdFinalizeMemberDepartureInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "finalize_member_departure"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const operation = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).finalizeMemberDeparture({
              expectedOperationVersion: command.expectedOperationVersion,
              now: yield* Clock.currentTimeMillis,
              operationId: command.operationId,
            });
            return yield* encodePeopleResult(
              HouseholdMemberDepartureOperation,
              operation
            );
          })
        ),
      ensureHousehold: (untrustedInput: HouseholdEnsureInput) =>
        scoped(
          Effect.gen(function* ensureHouseholdObject() {
            const input = yield* Schema.decodeUnknownEffect(
              HouseholdEnsureInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              input.admission,
              "ensure_household"
            );
            const connection = yield* database;
            return yield* ensureHouseholdProvenance(
              connection,
              input.admission.organizationId
            );
          })
        ),
      getHouseholdPerson: (untrustedInput: HouseholdGetPersonInput) =>
        scoped(
          Effect.gen(function* getHouseholdPerson() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdGetPersonInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "get_household_person"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const person = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).get({
              actorId: command.admission.actor.actorId,
              linkageSubject: command.admission.actor.linkageSubject,
              personId: command.personId,
            });
            return yield* encodePeopleResult(HouseholdPerson, person);
          })
        ),
      getMemberDeparture: (
        untrustedInput:
          | HouseholdGetMemberDepartureInput
          | HouseholdReadMemberDepartureSystemInput
      ) =>
        scoped(
          Effect.gen(function* getMemberDeparture() {
            const command = yield* Schema.decodeUnknownEffect(
              Schema.Union([
                HouseholdGetMemberDepartureInput,
                HouseholdReadMemberDepartureSystemInput,
              ]),
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "get_member_departure"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const repository = makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            });
            if (command.admission.actor._tag === "System") {
              return yield* encodePeopleResult(
                HouseholdMemberDepartureSystemState,
                yield* repository.getMemberDepartureSystem({
                  operationId: command.operationId,
                })
              );
            }
            return yield* encodePeopleResult(
              HouseholdMemberDepartureOperation,
              yield* repository.getMemberDeparture({
                callerIsOwner: command.admission.actor._tag === "PeopleCreator",
                callerLinkageSubject: command.admission.actor.linkageSubject,
                operationId: command.operationId,
              })
            );
          })
        ),
      getMemberDepartureByMutation: (
        untrustedInput: HouseholdGetMemberDepartureByMutationInput
      ) =>
        scoped(
          Effect.gen(function* getMemberDepartureByMutation() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdGetMemberDepartureByMutationInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "get_member_departure"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const operation = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).getMemberDepartureByMutation({
              callerIsOwner: command.admission.actor._tag === "PeopleCreator",
              callerLinkageSubject: command.admission.actor.linkageSubject,
              mutationId: command.mutationId,
            });
            return yield* encodePeopleResult(
              HouseholdMemberDepartureOperation,
              operation
            );
          })
        ),
      readPersonProfile: (untrustedInput: HouseholdReadPersonProfileInput) =>
        scoped(
          Effect.gen(function* readPersonProfile() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadPersonProfileInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_person_profile"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const result = yield* makeHouseholdProfileRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).get({
              actor: command.admission.actor,
              personId: command.personId,
              version: command.version,
            });
            return yield* Schema.encodeEffect(PersonProfile)(result).pipe(
              Effect.mapError(invalidInput)
            );
          })
        ),
      listProfileVersions: (
        untrustedInput: HouseholdListProfileVersionsInput
      ) =>
        scoped(
          Effect.gen(function* listProfileVersions() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdListProfileVersionsInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_person_profile"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const result = yield* makeHouseholdProfileRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).listVersions({
              actor: command.admission.actor,
              beforeVersion: command.beforeVersion,
              personId: command.personId,
            });
            return yield* Schema.encodeEffect(ProfileVersionPage)(result).pipe(
              Effect.mapError(invalidInput)
            );
          })
        ),
      mutatePersonProfile: (
        untrustedInput: HouseholdMutatePersonProfileInput
      ) =>
        scoped(
          Effect.gen(function* mutatePersonProfile() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdMutatePersonProfileInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "mutate_person_profile"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const result = yield* makeHouseholdProfileRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).mutate({
              actor: command.admission.actor,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
              personId: command.personId,
            });
            return yield* Schema.encodeEffect(PersonProfile)(result).pipe(
              Effect.mapError(invalidInput)
            );
          })
        ),
      listHouseholdPeople: (untrustedInput: HouseholdListPeopleInput) =>
        scoped(
          Effect.gen(function* listHouseholdPeople() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdListPeopleInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "list_household_people"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const roster = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).list({
              actorId: command.admission.actor.actorId,
              includeArchived: command.query.includeArchived === "true",
              linkageSubject: command.admission.actor.linkageSubject,
            });
            return yield* encodePeopleResult(HouseholdPeopleRoster, roster);
          })
        ),
      markMemberDepartureRepairRequired: (
        untrustedInput: HouseholdMarkMemberDepartureRepairRequiredInput
      ) =>
        scoped(
          Effect.gen(function* markMemberDepartureRepairRequired() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdMarkMemberDepartureRepairRequiredInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "mark_member_departure_repair_required"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const operation = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).markMemberDepartureRepairRequired({
              expectedOperationVersion: command.expectedOperationVersion,
              now: yield* Clock.currentTimeMillis,
              operationId: command.operationId,
              phase: command.phase,
            });
            return yield* encodePeopleResult(
              HouseholdMemberDepartureOperation,
              operation
            );
          })
        ),
      prepareMemberDeparture: (
        untrustedInput: HouseholdPrepareMemberDepartureInput
      ) =>
        scoped(
          Effect.gen(function* prepareMemberDeparture() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdPrepareMemberDepartureInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "prepare_member_departure"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const operation = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).prepareMemberDeparture({
              actorId: command.admission.actor.actorId,
              callerIsOwner: command.admission.actor._tag === "PeopleCreator",
              callerLinkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
              targetLinkageSubject: command.targetLinkageSubject,
            });
            return yield* encodePeopleResult(
              HouseholdMemberDepartureOperation,
              operation
            );
          })
        ),
      repairAdultAccountLink: (
        untrustedInput: HouseholdRepairAdultAccountLinkInput
      ) =>
        scoped(
          Effect.gen(function* repairAdultAccountLink() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdRepairAdultAccountLinkInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "repair_adult_account_link"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const person = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).repairAdultAccountLink({
              actorId: command.admission.actor.actorId,
              linkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
              targetLinkageSubject: command.targetLinkageSubject,
            });
            return yield* encodePeopleResult(HouseholdPerson, person);
          })
        ),
      restoreReturningAdultLink: (
        untrustedInput: HouseholdRestoreReturningAdultLinkInput
      ) =>
        scoped(
          Effect.gen(function* restoreReturningAdultLink() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdRestoreReturningAdultLinkInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "restore_returning_adult_link"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const person = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).restoreReturningAdultLink({
              actorId: command.admission.actor.actorId,
              linkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
            });
            return yield* encodePeopleResult(HouseholdPerson, person);
          })
        ),
      retryMemberDeparture: (
        untrustedInput: HouseholdRetryMemberDepartureInput
      ) =>
        scoped(
          Effect.gen(function* retryMemberDeparture() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdRetryMemberDepartureInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "retry_member_departure"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const start = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).retryMemberDeparture({
              actorId: command.admission.actor.actorId,
              callerIsOwner: command.admission.actor._tag === "PeopleCreator",
              callerLinkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              operationId: command.operationId,
              payload: command.payload,
              targetLinkageSubject: command.targetLinkageSubject,
            });
            return yield* encodePeopleResult(
              HouseholdMemberDepartureStart,
              start
            );
          })
        ),
      startMemberDeparture: (
        untrustedInput: HouseholdStartMemberDepartureInput
      ) =>
        scoped(
          Effect.gen(function* startMemberDeparture() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdStartMemberDepartureInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "start_member_departure"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const start = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).startMemberDeparture({
              callerIsOwner: command.admission.actor._tag === "PeopleCreator",
              callerLinkageSubject: command.admission.actor.linkageSubject,
              expectedOperationVersion: command.expectedOperationVersion,
              now: yield* Clock.currentTimeMillis,
              operationId: command.operationId,
            });
            return yield* encodePeopleResult(
              HouseholdMemberDepartureStart,
              start
            );
          })
        ),
      readMealPlan: (untrustedInput: HouseholdReadMealPlanInput) =>
        scoped(
          Effect.gen(function* readHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const plan = yield* makeService(connection, digest).read(
              command.draftId
            );
            return yield* Option.match(plan, {
              onNone: () => Effect.succeed(null),
              onSome: encodeMealPlan,
            });
          })
        ),
      readEvidenceReferences: (
        untrustedInput: HouseholdReadEvidenceReferencesInput
      ) =>
        scoped(
          Effect.gen(function* readHouseholdEvidenceReferences() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadEvidenceReferencesInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_evidence_references"
            );
            const connection = yield* database;
            const references =
              yield* makeHouseholdEvidenceRepository(connection).readReferences(
                command
              );
            return yield* encodeRecipeImportResult(
              HouseholdReadEvidenceReferencesResult,
              references
            );
          })
        ),
      readAcquisitionAttempts: (
        untrustedInput: HouseholdReadAcquisitionAttemptsInput
      ) =>
        scoped(
          Effect.gen(function* readHouseholdAcquisitionAttempts() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadAcquisitionAttemptsInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_acquisition_attempts"
            );
            const connection = yield* database;
            const attempts =
              yield* makeHouseholdEvidenceRepository(
                connection
              ).readAcquisitionAttempts(command);
            return yield* encodeRecipeImportResult(
              HouseholdReadAcquisitionAttemptsResult,
              attempts
            );
          })
        ),
      readEvidenceStage: (
        untrustedInput: typeof HouseholdReadEvidenceStageInput.Encoded
      ) =>
        scoped(
          Effect.gen(function* readHouseholdEvidenceStage() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadEvidenceStageInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_evidence_stage"
            );
            const connection = yield* database;
            const stage =
              yield* makeHouseholdEvidenceRepository(connection).readStage(
                command
              );
            return yield* encodeRecipeImportResult(
              HouseholdReadEvidenceStageResult,
              stage
            );
          })
        ),
      readImportTerminalCheckpoint: (
        untrustedInput: typeof HouseholdReadImportTerminalCheckpointInput.Encoded
      ) =>
        scoped(
          Effect.gen(function* readHouseholdImportTerminalCheckpoint() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadImportTerminalCheckpointInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_import_terminal_checkpoint"
            );
            const connection = yield* database;
            const checkpoint =
              yield* makeHouseholdEvidenceRepository(
                connection
              ).readTerminalCheckpoint(command);
            return yield* encodeRecipeImportResult(
              HouseholdReadImportTerminalCheckpointResult,
              checkpoint
            );
          })
        ),
      readRecipeRecoveryAttempt: (
        untrustedInput: typeof HouseholdReadRecipeRecoveryAttemptInput.Encoded
      ) =>
        scoped(
          Effect.gen(function* readHouseholdRecipeRecoveryAttempt() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadRecipeRecoveryAttemptInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_recipe_recovery_attempt"
            );
            const connection = yield* database;
            const attempt =
              yield* makeHouseholdEvidenceRepository(
                connection
              ).readRecipeRecoveryAttempt(command);
            return yield* encodeRecipeImportResult(
              HouseholdReadRecipeRecoveryAttemptResult,
              attempt
            );
          })
        ),
      readRecipe: (untrustedInput: typeof HouseholdReadRecipeInput.Type) =>
        scoped(
          Effect.gen(function* readHouseholdRecipe() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadRecipeInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_recipe"
            );
            const connection = yield* database;
            const recipe =
              yield* makeHouseholdRecipeImportRepository(connection).readRecipe(
                command
              );
            return yield* encodeRecipeImportResult(Recipe, recipe);
          })
        ),
      readRecipeImport: (
        untrustedInput: typeof HouseholdReadRecipeImportInput.Type
      ) =>
        scoped(
          Effect.gen(function* readHouseholdRecipeImport() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadRecipeImportInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_recipe_import"
            );
            const connection = yield* database;
            const intent =
              yield* makeHouseholdRecipeImportRepository(connection).readIntent(
                command
              );
            return yield* encodeRecipeImportResult(RecipeImportIntent, intent);
          })
        ),
      readRecipeImportExecution: (
        untrustedInput: HouseholdReadRecipeImportExecutionInput
      ) =>
        scoped(
          Effect.gen(function* readHouseholdRecipeImportExecution() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadRecipeImportExecutionInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_recipe_import_execution"
            );
            const connection = yield* database;
            const execution =
              yield* makeHouseholdRecipeImportRepository(
                connection
              ).readExecution(command);
            return yield* encodeRecipeImportResult(
              HouseholdRecipeImportExecutionView,
              execution
            );
          })
        ),
      readRecipeImportAction: (
        untrustedInput: typeof HouseholdReadRecipeImportActionInput.Type
      ) =>
        scoped(
          Effect.gen(function* readHouseholdRecipeImportAction() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadRecipeImportActionInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_recipe_import_action"
            );
            const connection = yield* database;
            const action =
              yield* makeHouseholdRecipeImportRepository(connection).readAction(
                command
              );
            return yield* encodeRecipeImportResult(RecipeImportAction, action);
          })
        ),
      readRecipeImportTimeline: (
        untrustedInput: typeof HouseholdReadRecipeImportInput.Type
      ) =>
        scoped(
          Effect.gen(function* readHouseholdRecipeImportTimeline() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadRecipeImportInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_recipe_import_timeline"
            );
            const connection = yield* database;
            const timeline =
              yield* makeHouseholdRecipeImportRepository(
                connection
              ).readTimeline(command);
            return yield* encodeRecipeImportResult(
              RecipeImportTimeline,
              timeline
            );
          })
        ),
      recordRecipeImportDispatch: (
        untrustedInput: HouseholdRecordRecipeImportDispatchInput
      ) =>
        scoped(
          Effect.gen(function* recordHouseholdRecipeImportDispatch() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdRecordRecipeImportDispatchInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "record_recipe_import_dispatch"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const nowEpochMs = yield* Clock.currentTimeMillis;
            const view = yield* makeImportWorkflowAdmissionRepository(
              connection
            )
              .recordDispatch({
                dispatchId: command.dispatchId,
                nowEpochMs,
                originalTrace: command.originalTrace,
                outcome: command.outcome,
                workflowIdentity: command.workflowIdentity,
              })
              .pipe(
                Effect.mapError(() =>
                  HouseholdRecipeImportFailure.make({
                    reason: "persistence_unavailable",
                  })
                )
              );
            return yield* encodeRecipeImportResult(
              HouseholdRecordRecipeImportDispatchResult,
              view
            );
          })
        ),
      readImportBatch: (untrustedInput: HouseholdReadImportBatchInput) =>
        scoped(
          Effect.gen(function* readHouseholdImportBatch() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadImportBatchInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_import_batch"
            );
            const connection = yield* database;
            return yield* makeHouseholdImportBatchRepository(connection)
              .read(command)
              .pipe(
                Effect.flatMap((batch) =>
                  encodeRecipeImportResult(RecipeImportBatch, batch)
                )
              );
          })
        ),
      recordImportBatchDispatch: (
        untrustedInput: HouseholdRecordImportBatchDispatchInput
      ) =>
        scoped(
          Effect.gen(function* recordHouseholdImportBatchDispatch() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdRecordImportBatchDispatchInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "record_import_batch_dispatch"
            );
            const connection = yield* database;
            const repository = makeHouseholdImportBatchRepository(connection);
            const result = yield* repository.recordDispatch(command);
            if (command.outcome === "retry") {
              const next = yield* repository.nextDispatchAt;
              if (next !== null) {
                yield* durableObjectState.storage.setAlarm(next);
              }
            }
            return result;
          })
        ),
      listRecipeBank: (untrustedInput: typeof HouseholdRecipePageInput.Type) =>
        scoped(
          Effect.gen(function* listHouseholdRecipeBank() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdRecipePageInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "list_recipe_bank"
            );
            const connection = yield* database;
            const page =
              yield* makeHouseholdRecipeImportRepository(
                connection
              ).listRecipePage(command);
            return yield* encodeRecipeImportResult(HouseholdRecipePage, page);
          })
        ),
      rejectMealPlan: (untrustedInput: HouseholdDecideMealPlanInput) =>
        scoped(
          Effect.gen(function* rejectHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdDecideMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "reject_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const admittedCommand = yield* Schema.decodeUnknownEffect(
              HouseholdMealPlanDecisionCommand
            )(command.request).pipe(Effect.mapError(invalidInput));
            const request = yield* admitMealPlanDecision(
              command.admission,
              admittedCommand
            ).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(connection, digest).reject(request);
            return yield* encodeMealPlan(plan);
          })
        ),
      resolveRecipeImportSource: (
        untrustedInput: HouseholdResolveRecipeImportSourceInput
      ) =>
        scoped(
          Effect.gen(function* resolveHouseholdRecipeImportSource() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdResolveRecipeImportSourceInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "resolve_recipe_import_source"
            );
            const connection = yield* database;
            const resolved =
              yield* makeHouseholdRecipeImportRepository(
                connection
              ).resolveSource(command);
            return yield* encodeRecipeImportResult(
              RecipeImportIntent,
              resolved
            );
          })
        ),
      transitionRecipeImportLifecycle: (
        untrustedInput: HouseholdTransitionRecipeImportLifecycleInput
      ) =>
        scoped(
          Effect.gen(function* transitionHouseholdRecipeImportLifecycle() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdTransitionRecipeImportLifecycleInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "transition_recipe_import_lifecycle"
            );
            const connection = yield* database;
            const transitioned =
              yield* makeHouseholdRecipeImportRepository(
                connection
              ).transitionLifecycle(command);
            return yield* encodeRecipeImportResult(
              RecipeImportIntent,
              transitioned
            );
          })
        ),
      restoreHouseholdPerson: (
        untrustedInput: HouseholdTransitionPersonInput
      ) =>
        scoped(
          Effect.gen(function* restoreHouseholdPerson() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdTransitionPersonInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "restore_household_person"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const person = yield* makeHouseholdPeopleRepository(connection, {
              canonical: canonicalEncoding,
              digest,
              identity: identityGenerator,
            }).restore({
              actorId: command.admission.actor.actorId,
              linkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
              personId: command.personId,
            });
            return yield* encodePeopleResult(HouseholdPerson, person);
          })
        ),
      swapMealPlan: (untrustedInput: HouseholdSwapMealPlanInput) =>
        scoped(
          Effect.gen(function* swapHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdSwapMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "swap_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const approvedRecipes = yield* Effect.all(
              command.approvedRecipes.map((recipe) =>
                Schema.decodeUnknownEffect(MealPlanRecipeSnapshot)(recipe).pipe(
                  Effect.mapError(invalidInput)
                )
              )
            );
            const admittedCommand = yield* Schema.decodeUnknownEffect(
              HouseholdManualMealSwapCommand
            )(command.request).pipe(Effect.mapError(invalidInput));
            const request = yield* admitManualMealSwap(
              command.admission,
              admittedCommand
            ).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(
              connection,
              digest,
              approvedRecipes
            ).swap(request);
            return yield* encodeMealPlan(plan);
          })
        ),
      swapMealPlanFromRecipeBank: (
        untrustedInput: HouseholdSwapMealPlanFromRecipeBankInput
      ) =>
        scoped(
          Effect.gen(function* swapHouseholdMealPlanFromRecipeBank() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdSwapMealPlanFromRecipeBankInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "swap_meal_plan_from_recipe_bank"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const admittedCommand = yield* Schema.decodeUnknownEffect(
              HouseholdManualMealSwapCommand
            )(command.request).pipe(Effect.mapError(invalidInput));
            const replacement = yield* makeHouseholdRecipeImportRepository(
              connection
            ).readPlanningRecipe(
              command.admission,
              admittedCommand.replacementImportId
            );
            const request = yield* admitManualMealSwap(
              command.admission,
              admittedCommand
            ).pipe(Effect.mapError(invalidInput));
            const plan = yield* makeService(connection, digest, [
              replacement,
            ]).swap(request);
            return yield* encodeMealPlan(plan);
          })
        ),
    });
  }
);
