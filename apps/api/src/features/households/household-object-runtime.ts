import {
  MealPlan,
  MealPlanPolicy,
  MealPlanRecipeSnapshot,
  MealPlanRequest,
} from "@meal-planner/household-api";
import {
  RecipeImportIntent,
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
import { makeHouseholdOutboxAlarm } from "./foundation/household-outbox-alarm.live.js";
import { ensureHouseholdProvenance } from "./foundation/household-provenance.js";
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
} from "./household-meal-plan.contract.js";
import { makeHouseholdMealPlanRepository } from "./household-meal-plan.repository.js";
import {
  HouseholdEnsureInput,
  HouseholdInvalidInput,
} from "./household.contract.js";
import {
  HouseholdAdmitRecipeImportInput,
  HouseholdAdmitRecipeImportResult,
  HouseholdActiveRecipeImportActionResult,
  HouseholdCommitRecipeImportDraftInput,
  HouseholdConfirmRecipeImportActionInput,
  HouseholdResolveRecipeImportSourceInput,
} from "./recipe-import/household-recipe-import.contract.js";
import type {
  HouseholdRecipePage,
  HouseholdRecipePageCursor,
} from "./recipe-import/household-recipe-import.contract.js";
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
            const alarm = makeHouseholdOutboxAlarm(durableObjectState);
            yield* Clock.currentTimeMillis.pipe(
              Effect.flatMap(alarm.schedule),
              Effect.catch(() => Effect.void)
            );
            return yield* encodeRecipeImportResult(
              HouseholdAdmitRecipeImportResult,
              committed
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
                  byteLimit: 524_288,
                  cursor,
                  limit: 100,
                });
              const candidates = yield* Effect.forEach(
                (recipe: (typeof page.items)[number]) =>
                  Schema.decodeUnknownEffect(MealPlanRecipeAuthorityToken)({
                    extractionFingerprint: recipe.extractionFingerprint,
                    reviewVersion: recipe.version,
                    tagsFingerprint: recipe.extractionFingerprint,
                  }).pipe(
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
    });
  }
);
