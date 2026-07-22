import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeSyntheticMealPlanTracer,
  syntheticHardConstraintRecipeId,
  syntheticMealPlanRequest,
  syntheticPlanningPolicy,
  syntheticRejectedRecipeId,
  syntheticReplacementRecipeId,
} from "./meal-plan.fake.js";
import {
  MealPlanDecisionRequest,
  MealPlanRequest,
  ManualMealSwapRequest,
} from "./meal-plan.js";

describe("provider-free meal-plan tracer", () => {
  it("creates an approved-only deterministic draft with explicit hard-constraint gaps", async () => {
    const tracer = makeSyntheticMealPlanTracer();

    const first = await Effect.runPromise(
      tracer.service.create(syntheticMealPlanRequest, syntheticPlanningPolicy)
    );
    const replay = await Effect.runPromise(
      tracer.service.create(syntheticMealPlanRequest, syntheticPlanningPolicy)
    );
    const independent = await Effect.runPromise(
      makeSyntheticMealPlanTracer().service.create(
        syntheticMealPlanRequest,
        syntheticPlanningPolicy
      )
    );

    expect(first).toEqual(replay);
    expect(first).toEqual(independent);
    expect(first._tag).toBe("Draft");
    expect(first.revision).toBe(0);
    expect(first.meals).toHaveLength(1);
    expect(first.meals[0]).toMatchObject({
      reasons: [
        "approved_recipe",
        "meal_type_match",
        "hard_constraints_satisfied",
        "preferred_cuisine",
      ],
      relevantTags: {
        cuisines: ["Synthetic Mediterranean"],
        dietaryFit: "household_match",
        difficulty: "easy",
        leftovers: "one_meal",
        mealTypes: ["dinner"],
        totalTimeBand: "under_30_minutes",
      },
      servings: 2,
      slotId: "synthetic-dinner",
      sourceRecipe: {
        recipe: { name: "Synthetic Tomato Orzo" },
      },
    });
    expect(first.gaps).toEqual([
      {
        reason: "no_eligible_approved_recipe",
        slotId: "synthetic-breakfast",
      },
    ]);
    expect(
      first.meals.some(
        ({ sourceRecipe }) =>
          sourceRecipe.recipe.name === "Synthetic Rejected Pancakes"
      )
    ).toBe(false);
    expect(tracer.drafts).toHaveLength(1);
  });

  it("validates and audits a manual swap exactly once", async () => {
    const tracer = makeSyntheticMealPlanTracer();
    const draft = await Effect.runPromise(
      tracer.service.create(syntheticMealPlanRequest, syntheticPlanningPolicy)
    );
    const decodeSwap = Schema.decodeUnknownSync(ManualMealSwapRequest);
    const baseSwap = {
      actorId: "synthetic_operator",
      draftId: draft.draftId,
      expectedRevision: 0,
      reason: "Exercise the explicit manual review seam.",
      slotId: "synthetic-dinner",
      swappedAt: "2026-07-22T10:03:00.000Z",
    } as const;

    const rejected = await Effect.runPromise(
      Effect.flip(
        tracer.service.swap(
          decodeSwap({
            ...baseSwap,
            mutationId: "swap-rejected-recipe",
            replacementImportId: syntheticRejectedRecipeId,
          })
        )
      )
    );
    expect(rejected).toMatchObject({
      _tag: "MealPlanSwapRejected",
      reason: "recipe_not_approved",
    });

    const hardConstraintViolation = await Effect.runPromise(
      Effect.flip(
        tracer.service.swap(
          decodeSwap({
            ...baseSwap,
            mutationId: "swap-hard-constraint",
            replacementImportId: syntheticHardConstraintRecipeId,
          })
        )
      )
    );
    expect(hardConstraintViolation).toMatchObject({
      _tag: "MealPlanSwapRejected",
      reason: "hard_constraint_violation",
    });

    const request = decodeSwap({
      ...baseSwap,
      mutationId: "swap-valid-recipe",
      replacementImportId: syntheticReplacementRecipeId,
    });
    const swapped = await Effect.runPromise(tracer.service.swap(request));
    const replay = await Effect.runPromise(tracer.service.swap(request));

    expect(swapped).toEqual(replay);
    expect(swapped._tag).toBe("Draft");
    expect(swapped.revision).toBe(1);
    expect(swapped.meals[0]?.sourceRecipe.recipe.name).toBe(
      "Synthetic Bean Traybake"
    );
    expect(swapped.audit).toHaveLength(1);
    expect(swapped.audit[0]).toMatchObject({
      actorId: "synthetic_operator",
      fromRecipe: { recipe: { name: "Synthetic Tomato Orzo" } },
      mutationId: "swap-valid-recipe",
      toRecipe: { recipe: { name: "Synthetic Bean Traybake" } },
    });

    const stale = await Effect.runPromise(
      Effect.flip(
        tracer.service.swap(
          decodeSwap({
            ...baseSwap,
            mutationId: "swap-stale-revision",
            replacementImportId: syntheticHardConstraintRecipeId,
          })
        )
      )
    );
    expect(stale).toMatchObject({
      _tag: "MealPlanVersionConflict",
      actualRevision: 1,
      expectedRevision: 0,
    });
    const mutationCollision = await Effect.runPromise(
      Effect.flip(
        tracer.service.swap(
          decodeSwap({
            ...baseSwap,
            mutationId: "swap-valid-recipe",
            replacementImportId: syntheticHardConstraintRecipeId,
          })
        )
      )
    );
    expect(mutationCollision).toMatchObject({
      _tag: "MealPlanMutationConflict",
      mutationId: "swap-valid-recipe",
    });
    expect(
      Option.getOrThrow(
        await Effect.runPromise(tracer.service.read(draft.draftId))
      )
    ).toEqual(swapped);

    const maxUseTracer = makeSyntheticMealPlanTracer();
    const maxUseDraft = await Effect.runPromise(
      maxUseTracer.service.create(
        Schema.decodeUnknownSync(MealPlanRequest)({
          requestKey: "synthetic-max-use",
          slots: [
            {
              date: "2026-07-27",
              mealType: "dinner",
              servings: 2,
              slotId: "synthetic-dinner-one",
            },
            {
              date: "2026-07-28",
              mealType: "dinner",
              servings: 2,
              slotId: "synthetic-dinner-two",
            },
          ],
        }),
        syntheticPlanningPolicy
      )
    );
    const maxUseViolation = await Effect.runPromise(
      Effect.flip(
        maxUseTracer.service.swap(
          decodeSwap({
            ...baseSwap,
            draftId: maxUseDraft.draftId,
            mutationId: "swap-max-use-violation",
            replacementImportId: syntheticReplacementRecipeId,
            slotId: "synthetic-dinner-one",
          })
        )
      )
    );
    expect(maxUseViolation).toMatchObject({
      _tag: "MealPlanSwapRejected",
      reason: "hard_constraint_violation",
    });
  });

  it("keeps drafts review-gated and rejects stale or terminal lifecycle writes", async () => {
    const tracer = makeSyntheticMealPlanTracer();
    const draft = await Effect.runPromise(
      tracer.service.create(syntheticMealPlanRequest, syntheticPlanningPolicy)
    );
    const decodeDecision = Schema.decodeUnknownSync(MealPlanDecisionRequest);
    const decisionBase = {
      actorId: "synthetic_operator",
      decidedAt: "2026-07-22T10:04:00.000Z",
      draftId: draft.draftId,
      expectedRevision: 0,
      reason: "Synthetic tracer approval.",
    } as const;
    const approve = decodeDecision({
      ...decisionBase,
      mutationId: "approve-synthetic-draft",
    });

    expect(draft._tag).toBe("Draft");
    const approved = await Effect.runPromise(tracer.service.approve(approve));
    const approveReplay = await Effect.runPromise(
      tracer.service.approve(approve)
    );
    expect(approved).toEqual(approveReplay);
    expect(approved).toMatchObject({ _tag: "Approved", revision: 1 });

    const decisionCollision = await Effect.runPromise(
      Effect.flip(tracer.service.reject(approve))
    );
    expect(decisionCollision).toMatchObject({
      _tag: "MealPlanMutationConflict",
      mutationId: "approve-synthetic-draft",
    });

    const illegalReject = await Effect.runPromise(
      Effect.flip(
        tracer.service.reject(
          decodeDecision({
            ...decisionBase,
            expectedRevision: 1,
            mutationId: "reject-approved-draft",
          })
        )
      )
    );
    expect(illegalReject).toMatchObject({
      _tag: "MealPlanTransitionRejected",
      lifecycle: "Approved",
    });

    const stored = Option.getOrThrow(
      await Effect.runPromise(tracer.service.read(draft.draftId))
    );
    expect(stored).toEqual(approved);

    const rejectedTracer = makeSyntheticMealPlanTracer();
    const rejectedDraft = await Effect.runPromise(
      rejectedTracer.service.create(
        syntheticMealPlanRequest,
        syntheticPlanningPolicy
      )
    );
    const rejected = await Effect.runPromise(
      rejectedTracer.service.reject(
        decodeDecision({
          ...decisionBase,
          draftId: rejectedDraft.draftId,
          mutationId: "reject-synthetic-draft",
        })
      )
    );
    expect(rejected).toMatchObject({ _tag: "Rejected", revision: 1 });
  });
});
