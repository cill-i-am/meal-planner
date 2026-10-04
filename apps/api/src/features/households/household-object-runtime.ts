import {
  PersonProfile,
  InterviewProfileOutcome,
  ProfileVersionPage,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureStart,
  HouseholdPerson,
  MealPlan,
  ChangeMealPlanPayload,
  DecideMealPlanPayload,
  MealPlanRequest,
  MealPlanSummary,
  MutatePlanningContentPayload,
  PlanningContentSnapshot,
  SavedRecipePage,
  SavedRecipePageQuery,
  toMealPlanSummary,
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

import { makeMealPlanService } from "../meal-planning/meal-plan.js";
import { HouseholdOutputFence } from "../private-output/household-output-fence.js";
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
  admitMealPlanChange,
  admitMealPlanDecision,
} from "./household-meal-plan-admission.js";
import {
  HouseholdChangeMealPlanInput,
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdMutatePlanningContentInput,
  HouseholdListSavedRecipesInput,
  HouseholdReadPlanningContentInput,
  HouseholdReadMealPlanInput,
} from "./household-meal-plan.contract.js";
import { makeHouseholdMealPlanRepository } from "./household-meal-plan.repository.js";
import { readHouseholdPlanningAuthority } from "./household-planning-authority.js";
import {
  HouseholdEnsureInput,
  HouseholdInvalidInput,
} from "./household.contract.js";
import { makeHouseholdMealContentRepository } from "./meal-content/household-meal-content.repository.js";
import {
  HouseholdPeoplePrivateRoster,
  HouseholdAssociateAdultInvitationInput,
  HouseholdBootstrapCreatorPersonInput,
  HouseholdCancelMemberDepartureInput,
  HouseholdCompleteAcceptedAdultLinkInput,
  HouseholdConfirmAdultInvitationRecipientInput,
  HouseholdConfirmMemberAccessRevokedInput,
  HouseholdCreatePersonInput,
  HouseholdPreparePersonRemovalInput,
  HouseholdPersonRemovalPlan,
  HouseholdRenamePersonInput,
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
import {
  hasHouseholdPersonMutationReceipt,
  makeHouseholdPeopleRepository,
} from "./people/household-people.repository.js";
import {
  HouseholdReadPersonProfileInput,
  HouseholdListProfileVersionsInput,
  HouseholdMutatePersonProfileInput,
  HouseholdMutateInterviewProfileInput,
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
  HouseholdRecipePage,
  HouseholdRecipePageInput,
  HouseholdResolveRecipeImportSourceInput,
  HouseholdTransitionRecipeImportLifecycleInput,
} from "./recipe-import/household-recipe-import.contract.js";
import { makeHouseholdRecipeImportRepository } from "./recipe-import/household-recipe-import.repository.js";
import { requireHouseholdCommandAdmission } from "./rpc/command-envelope.js";
import type { HouseholdPeopleMemberAdmission } from "./rpc/command-envelope.js";
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
  digest: Effect.Success<typeof HouseholdDigest>
) => makeMealPlanService(makeHouseholdMealPlanRepository(database, digest));

export const makeHouseholdObjectRuntime = (
  migrations: NonNullable<Drizzle.DurableObjectConfig["migrations"]>
) =>
  Effect.gen(function* initializeHouseholdObject() {
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    const canonicalEncoding = yield* HouseholdCanonicalEncoding;
    const digest = yield* HouseholdDigest;
    const identityGenerator = yield* HouseholdIdentityGenerator;
    const batchQueueWriter = yield* HouseholdImportBatchQueueWriter;
    const outputFence = yield* HouseholdOutputFence;
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
    const planningAuthority = (
      connection: EffectSQLiteDoDatabase,
      admission: HouseholdPeopleMemberAdmission
    ) =>
      readHouseholdPlanningAuthority(connection, admission.actor, {
        canonical: canonicalEncoding,
        digest,
        identity: identityGenerator,
      });

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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "associateAdultInvitation" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* applyAssociateAdultInvitation() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const person = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).associateAdultInvitation({
                  actorId: command.admission.actor.actorId,
                  linkageSubject: command.admission.actor.linkageSubject,
                  now: yield* Clock.currentTimeMillis,
                  payload: command.payload,
                });
                return yield* encodePeopleResult(HouseholdPerson, person);
              })
            );
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
            if (command.cancelledInvitationDigest !== undefined) {
              yield* requireHouseholdCommandAdmission(
                command.admission,
                "prepare_person_removal"
              );
            }
            const intent = yield* canonicalEncoding
              .encode({ command, method: "archiveHouseholdPerson" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* applyArchiveHouseholdPerson() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const { admission, ...transition } = command;
                const person = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).archive({
                  ...transition,
                  actorId: admission.actor.actorId,
                  linkageSubject: admission.actor.linkageSubject,
                  now: yield* Clock.currentTimeMillis,
                });
                return yield* encodePeopleResult(HouseholdPerson, person);
              })
            );
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "bootstrapCreatorPerson" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* applyBootstrapCreatorPerson() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const person = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).bootstrapCreator({
                  actorId: command.admission.actor.actorId,
                  linkageSubject: command.admission.actor.linkageSubject,
                  now: yield* Clock.currentTimeMillis,
                  payload: command.payload,
                });
                return yield* encodePeopleResult(HouseholdPerson, person);
              })
            );
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
            const payload = yield* Schema.decodeUnknownEffect(
              DecideMealPlanPayload
            )(command.payload).pipe(Effect.mapError(invalidInput));
            const admitted = yield* admitMealPlanDecision(
              command.admission,
              command.planId,
              payload
            ).pipe(Effect.mapError(invalidInput));
            const authority = yield* planningAuthority(
              connection,
              command.admission
            );
            return yield* makeService(connection, digest)
              .approve(admitted, authority)
              .pipe(Effect.flatMap(encodeMealPlan));
          })
        ),
      acceptMealPlanRevision: (untrustedInput: HouseholdDecideMealPlanInput) =>
        scoped(
          Effect.gen(function* acceptMealPlanRevision() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdDecideMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "accept_meal_plan_revision"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const payload = yield* Schema.decodeUnknownEffect(
              DecideMealPlanPayload
            )(command.payload).pipe(Effect.mapError(invalidInput));
            const admitted = yield* admitMealPlanDecision(
              command.admission,
              command.planId,
              payload
            ).pipe(Effect.mapError(invalidInput));
            const authority = yield* planningAuthority(
              connection,
              command.admission
            );
            return yield* makeService(connection, digest)
              .acceptRevision(admitted, authority)
              .pipe(Effect.flatMap(encodeMealPlan));
          })
        ),
      preparePersonRemoval: (
        untrustedInput: HouseholdPreparePersonRemovalInput
      ) =>
        scoped(
          Effect.gen(function* preparePersonRemoval() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdPreparePersonRemovalInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "prepare_person_removal"
            );
            const intent = yield* canonicalEncoding
              .encode({ command, method: "preparePersonRemoval" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* retainRemovalIntent() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const person = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).prepareRemoval({
                  actorId: command.admission.actor.actorId,
                  linkageSubject: command.admission.actor.linkageSubject,
                  payload: command.payload,
                  personId: command.personId,
                });
                return yield* encodePeopleResult(
                  HouseholdPersonRemovalPlan,
                  person
                );
              })
            );
          })
        ),
      renameHouseholdPerson: (untrustedInput: HouseholdRenamePersonInput) =>
        scoped(
          Effect.gen(function* renameHouseholdPerson() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdRenamePersonInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "rename_household_person"
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
            }).rename({
              actorId: command.admission.actor.actorId,
              linkageSubject: command.admission.actor.linkageSubject,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
              personId: command.personId,
            });
            return yield* encodePeopleResult(HouseholdPerson, person);
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
            const request = yield* Schema.decodeUnknownEffect(MealPlanRequest)(
              command.request
            ).pipe(Effect.mapError(invalidInput));
            const authority = yield* planningAuthority(
              connection,
              command.admission
            );
            return yield* makeService(connection, digest)
              .create(request, authority)
              .pipe(Effect.flatMap(encodeMealPlan));
          })
        ),
      changeMealPlan: (untrustedInput: HouseholdChangeMealPlanInput) =>
        scoped(
          Effect.gen(function* changeHouseholdMealPlan() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdChangeMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "change_meal_plan"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const payload = yield* Schema.decodeUnknownEffect(
              ChangeMealPlanPayload
            )(command.payload).pipe(Effect.mapError(invalidInput));
            const admitted = yield* admitMealPlanChange(
              command.admission,
              command.planId,
              payload
            ).pipe(Effect.mapError(invalidInput));
            const authority = yield* planningAuthority(
              connection,
              command.admission
            );
            return yield* makeService(connection, digest)
              .change(admitted, authority)
              .pipe(Effect.flatMap(encodeMealPlan));
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "completeAcceptedAdultLink" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* applyCompleteAcceptedAdultLink() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const person = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).completeAcceptedAdultLink({
                  actorId: command.admission.actor.actorId,
                  linkageSubject: command.admission.actor.linkageSubject,
                  now: yield* Clock.currentTimeMillis,
                  payload: command.payload,
                });
                return yield* encodePeopleResult(HouseholdPerson, person);
              })
            );
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "confirmAdultInvitationRecipient" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: Effect.succeed(false),
              },
              Effect.gen(function* applyConfirmAdultInvitationRecipient() {
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
            );
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "cancelMemberDeparture" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* applyCancelMemberDeparture() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const operation = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).cancelMemberDeparture({
                  actorId: command.admission.actor.actorId,
                  callerIsOwner:
                    command.admission.actor._tag === "PeopleCreator",
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "confirmMemberAccessRevoked" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: Effect.succeed(false),
              },
              Effect.gen(function* applyConfirmMemberAccessRevoked() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const operation = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).confirmMemberAccessRevoked({
                  expectedOperationVersion: command.expectedOperationVersion,
                  now: yield* Clock.currentTimeMillis,
                  operationId: command.operationId,
                });
                return yield* encodePeopleResult(
                  HouseholdMemberDepartureOperation,
                  operation
                );
              })
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "finalizeMemberDeparture" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: Effect.succeed(false),
              },
              Effect.gen(function* applyFinalizeMemberDeparture() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const operation = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).finalizeMemberDeparture({
                  expectedOperationVersion: command.expectedOperationVersion,
                  now: yield* Clock.currentTimeMillis,
                  operationId: command.operationId,
                });
                return yield* encodePeopleResult(
                  HouseholdMemberDepartureOperation,
                  operation
                );
              })
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
      mutateInterviewProfile: (
        untrustedInput: HouseholdMutateInterviewProfileInput
      ) =>
        scoped(
          Effect.gen(function* mutateInterviewProfile() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdMutateInterviewProfileInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "mutate_interview_profile"
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
            }).mutateInterview({
              actor: command.admission.actor,
              now: yield* Clock.currentTimeMillis,
              payload: command.payload,
              personId: command.personId,
            });
            return yield* Schema.encodeEffect(InterviewProfileOutcome)(
              result
            ).pipe(Effect.mapError(invalidInput));
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
            return yield* encodePeopleResult(
              HouseholdPeoplePrivateRoster,
              roster
            );
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "markMemberDepartureRepairRequired" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: Effect.succeed(false),
              },
              Effect.gen(function* applyMarkMemberDepartureRepairRequired() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const operation = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).markMemberDepartureRepairRequired({
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "prepareMemberDeparture" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* applyPrepareMemberDeparture() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const operation = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).prepareMemberDeparture({
                  actorId: command.admission.actor.actorId,
                  callerIsOwner:
                    command.admission.actor._tag === "PeopleCreator",
                  callerLinkageSubject: command.admission.actor.linkageSubject,
                  now: yield* Clock.currentTimeMillis,
                  payload: command.payload,
                  removalMutationId: command.removalMutationId,
                  targetLinkageSubject: command.targetLinkageSubject,
                });
                return yield* encodePeopleResult(
                  HouseholdMemberDepartureOperation,
                  operation
                );
              })
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "repairAdultAccountLink" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* applyRepairAdultAccountLink() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const person = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).repairAdultAccountLink({
                  actorId: command.admission.actor.actorId,
                  linkageSubject: command.admission.actor.linkageSubject,
                  now: yield* Clock.currentTimeMillis,
                  payload: command.payload,
                  targetLinkageSubject: command.targetLinkageSubject,
                });
                return yield* encodePeopleResult(HouseholdPerson, person);
              })
            );
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "restoreReturningAdultLink" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* applyRestoreReturningAdultLink() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const person = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).restoreReturningAdultLink({
                  actorId: command.admission.actor.actorId,
                  linkageSubject: command.admission.actor.linkageSubject,
                  now: yield* Clock.currentTimeMillis,
                  payload: command.payload,
                });
                return yield* encodePeopleResult(HouseholdPerson, person);
              })
            );
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "retryMemberDeparture" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* applyRetryMemberDeparture() {
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
                  callerIsOwner:
                    command.admission.actor._tag === "PeopleCreator",
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "startMemberDeparture" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: Effect.succeed(false),
              },
              Effect.gen(function* applyStartMemberDeparture() {
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
                  callerIsOwner:
                    command.admission.actor._tag === "PeopleCreator",
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
            yield* makeHouseholdMealContentRepository(connection, digest).read(
              command.admission.actor
            );
            const plan = yield* makeService(connection, digest).read(
              command.planId
            );
            return yield* Option.match(plan, {
              onNone: () => Effect.succeed(null),
              onSome: encodeMealPlan,
            });
          })
        ),
      listMealPlans: (untrustedInput: HouseholdReadPlanningContentInput) =>
        scoped(
          Effect.gen(function* listHouseholdMealPlans() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadPlanningContentInput,
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
            yield* makeHouseholdMealContentRepository(connection, digest).read(
              command.admission.actor
            );
            const plans = yield* makeService(connection, digest).listRecent();
            return yield* Schema.encodeEffect(Schema.Array(MealPlanSummary))(
              plans.map(toMealPlanSummary)
            ).pipe(Effect.mapError(invalidInput));
          })
        ),
      readPlanningContent: (
        untrustedInput: HouseholdReadPlanningContentInput
      ) =>
        scoped(
          Effect.gen(function* readPlanningContent() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdReadPlanningContentInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "read_planning_content"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const content = yield* makeHouseholdMealContentRepository(
              connection,
              digest
            ).read(command.admission.actor);
            return yield* Schema.encodeEffect(PlanningContentSnapshot)(
              content
            ).pipe(Effect.mapError(invalidInput));
          })
        ),
      listSavedRecipes: (untrustedInput: HouseholdListSavedRecipesInput) =>
        scoped(
          Effect.gen(function* listSavedRecipes() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdListSavedRecipesInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "list_saved_recipes"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const query = yield* Schema.decodeUnknownEffect(
              SavedRecipePageQuery
            )(command.query).pipe(Effect.mapError(invalidInput));
            const page = yield* makeHouseholdMealContentRepository(
              connection,
              digest
            ).listSavedRecipes(command.admission.actor, query);
            return yield* Schema.encodeEffect(SavedRecipePage)(page).pipe(
              Effect.mapError(invalidInput)
            );
          })
        ),
      mutatePlanningContent: (
        untrustedInput: HouseholdMutatePlanningContentInput
      ) =>
        scoped(
          Effect.gen(function* mutatePlanningContent() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdMutatePlanningContentInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "mutate_planning_content"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const payload = yield* Schema.decodeUnknownEffect(
              MutatePlanningContentPayload,
              { onExcessProperty: "error" }
            )(command.payload).pipe(Effect.mapError(invalidInput));
            const content = yield* makeHouseholdMealContentRepository(
              connection,
              digest
            ).mutate(command.admission.actor, payload);
            return yield* Schema.encodeEffect(PlanningContentSnapshot)(
              content
            ).pipe(Effect.mapError(invalidInput));
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
      rejectMealPlanRevision: (untrustedInput: HouseholdDecideMealPlanInput) =>
        scoped(
          Effect.gen(function* rejectMealPlanRevision() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdDecideMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "reject_meal_plan_revision"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const payload = yield* Schema.decodeUnknownEffect(
              DecideMealPlanPayload
            )(command.payload).pipe(Effect.mapError(invalidInput));
            const admitted = yield* admitMealPlanDecision(
              command.admission,
              command.planId,
              payload
            ).pipe(Effect.mapError(invalidInput));
            yield* makeHouseholdMealContentRepository(connection, digest).read(
              command.admission.actor
            );
            return yield* makeService(connection, digest)
              .rejectRevision(admitted)
              .pipe(Effect.flatMap(encodeMealPlan));
          })
        ),
      proposeMealPlanRevision: (untrustedInput: HouseholdDecideMealPlanInput) =>
        scoped(
          Effect.gen(function* proposeMealPlanRevision() {
            const command = yield* Schema.decodeUnknownEffect(
              HouseholdDecideMealPlanInput,
              { onExcessProperty: "error" }
            )(untrustedInput).pipe(Effect.mapError(invalidInput));
            yield* requireHouseholdCommandAdmission(
              command.admission,
              "propose_meal_plan_revision"
            );
            const connection = yield* database;
            yield* ensureHouseholdProvenance(
              connection,
              command.admission.organizationId
            );
            const payload = yield* Schema.decodeUnknownEffect(
              DecideMealPlanPayload
            )(command.payload).pipe(Effect.mapError(invalidInput));
            const admitted = yield* admitMealPlanDecision(
              command.admission,
              command.planId,
              payload
            ).pipe(Effect.mapError(invalidInput));
            const authority = yield* planningAuthority(
              connection,
              command.admission
            );
            return yield* makeService(connection, digest)
              .proposeRevision(admitted, authority)
              .pipe(Effect.flatMap(encodeMealPlan));
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
            const intent = yield* canonicalEncoding
              .encode({ command, method: "restoreHouseholdPerson" })
              .pipe(Effect.mapError(invalidInput));
            const intentKey = yield* digest
              .sha256(intent)
              .pipe(Effect.mapError(invalidInput));
            return yield* outputFence.run(
              {
                intentKey,
                organizationId: command.admission.organizationId,
                wasCommitted: database.pipe(
                  Effect.flatMap((connection) =>
                    hasHouseholdPersonMutationReceipt(
                      connection,
                      command.payload.mutationId
                    )
                  )
                ),
              },
              Effect.gen(function* applyRestoreHouseholdPerson() {
                const connection = yield* database;
                yield* ensureHouseholdProvenance(
                  connection,
                  command.admission.organizationId
                );
                const person = yield* makeHouseholdPeopleRepository(
                  connection,
                  {
                    canonical: canonicalEncoding,
                    digest,
                    identity: identityGenerator,
                  }
                ).restore({
                  actorId: command.admission.actor.actorId,
                  linkageSubject: command.admission.actor.linkageSubject,
                  now: yield* Clock.currentTimeMillis,
                  payload: command.payload,
                  personId: command.personId,
                });
                return yield* encodePeopleResult(HouseholdPerson, person);
              })
            );
          })
        ),
    });
  });
