import { MealPlanRecipeSnapshot as SharedMealPlanRecipeSnapshot } from "@meal-planner/household-api";
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
  addMealPlanCandidatePage,
  makeDeterministicMealPlanPlanner,
  makeMealPlanCandidateFrontier,
  MealPlanDecisionRequest,
  MealPlanPolicy,
  MealPlanRecipeAuthorityToken,
  MealPlanRecipeSnapshotId,
  MealPlanTags,
  MealPlanRecipeSnapshot,
  MealPlanRequest,
  ManualMealSwapRequest,
  selectMealPlanCandidates,
} from "./meal-plan.js";

const decodeCandidateId = Schema.decodeUnknownSync(MealPlanRecipeSnapshotId);
const decodeCandidateTags = Schema.decodeUnknownSync(MealPlanTags);
const decodeCandidatePolicy = Schema.decodeUnknownSync(MealPlanPolicy);
const decodeCandidateRequest = Schema.decodeUnknownSync(MealPlanRequest);
const decodeCandidateAuthorityToken = Schema.decodeUnknownSync(
  MealPlanRecipeAuthorityToken
);
const decodeCandidateSnapshot = Schema.decodeUnknownSync(
  MealPlanRecipeSnapshot
);

const candidateId = (index: number) =>
  decodeCandidateId(
    `018f47ad-91aa-7c35-b6fe-${index.toString().padStart(12, "0")}`
  );

const candidateTags = (input: {
  readonly cuisine: string;
  readonly mealTypes: readonly ("breakfast" | "dinner" | "lunch")[];
}) =>
  decodeCandidateTags({
    cuisines: [input.cuisine],
    dietaryFit: "household_match",
    difficulty: "easy",
    leftovers: "none",
    mealTypes: input.mealTypes,
    totalTimeBand: "under_30_minutes",
  });

const candidateAuthorityToken = (index: number, reviewVersion = 1) => {
  const fingerprint = index.toString(16).padStart(64, "0");
  return decodeCandidateAuthorityToken({
    extractionFingerprint: fingerprint,
    reviewVersion,
    tagsFingerprint: fingerprint,
  });
};

const candidateSnapshot = (candidate: {
  readonly authorityToken: ReturnType<typeof candidateAuthorityToken>;
  readonly importId: ReturnType<typeof candidateId>;
  readonly tags: ReturnType<typeof candidateTags>;
}) =>
  decodeCandidateSnapshot({
    approvedAt: "2026-08-19T20:00:00.000Z",
    extractionFingerprint: candidate.authorityToken.extractionFingerprint,
    importId: candidate.importId,
    recipe: {
      ingredientLines: ["1 bounded ingredient"],
      instructions: ["Prepare the bounded candidate."],
      name: `Candidate ${candidate.importId}`,
    },
    source: {
      evidenceFingerprint: `evidence:${candidate.importId}`,
      sourceUrl: null,
    },
    tags: candidate.tags,
    version: 1,
  });

const referenceCandidateSelection = (input: {
  readonly candidates: readonly {
    readonly importId: ReturnType<typeof candidateId>;
    readonly tags: ReturnType<typeof candidateTags>;
  }[];
  readonly policy: ReturnType<typeof decodeCandidatePolicy>;
  readonly request: ReturnType<typeof decodeCandidateRequest>;
}) => {
  const uses = new Map<string, number>();
  return input.request.slots.map((slot) => {
    const [candidate] = input.candidates
      .filter(
        ({ importId, tags }) =>
          tags.mealTypes.includes(slot.mealType) &&
          input.policy.allowedDietaryFit.includes(tags.dietaryFit) &&
          input.policy.allowedDifficulties.includes(tags.difficulty) &&
          input.policy.allowedTotalTimeBands.includes(tags.totalTimeBand) &&
          (uses.get(importId) ?? 0) < input.policy.maxRecipeUses
      )
      .toSorted((left, right) => {
        const leftPreferred = left.tags.cuisines.some((cuisine) =>
          input.policy.preferredCuisines.includes(cuisine)
        );
        const rightPreferred = right.tags.cuisines.some((cuisine) =>
          input.policy.preferredCuisines.includes(cuisine)
        );
        const preferredDifference =
          Number(rightPreferred) - Number(leftPreferred);
        return preferredDifference === 0
          ? left.importId.localeCompare(right.importId)
          : preferredDifference;
      });
    if (candidate === undefined) {
      return { slotId: slot.slotId } as const;
    }
    uses.set(candidate.importId, (uses.get(candidate.importId) ?? 0) + 1);
    return { importId: candidate.importId, slotId: slot.slotId } as const;
  });
};

describe("bounded meal-plan candidate selection", () => {
  it("preserves greedy selection across arbitrary pages larger than 128 candidates", async () => {
    const request = decodeCandidateRequest({
      requestKey: "candidate-frontier-large-catalogue",
      slots: [
        {
          date: "2026-08-24",
          mealType: "dinner",
          servings: 2,
          slotId: "dinner-one",
        },
        {
          date: "2026-08-25",
          mealType: "dinner",
          servings: 2,
          slotId: "dinner-two",
        },
        {
          date: "2026-08-26",
          mealType: "breakfast",
          servings: 2,
          slotId: "breakfast-one",
        },
        {
          date: "2026-08-27",
          mealType: "dinner",
          servings: 2,
          slotId: "dinner-three",
        },
        {
          date: "2026-08-28",
          mealType: "lunch",
          servings: 2,
          slotId: "lunch-gap",
        },
      ],
    });
    const policy = decodeCandidatePolicy({
      allowedDietaryFit: ["household_match"],
      allowedDifficulties: ["easy"],
      allowedTotalTimeBands: ["under_30_minutes"],
      maxRecipeUses: 1,
      preferredCuisines: ["preferred"],
      version: "candidate-frontier-v1",
    });
    const ordinaryDinners = Array.from({ length: 180 }, (_, index) => ({
      authorityToken: candidateAuthorityToken(index + 1),
      importId: candidateId(index + 1),
      tags: candidateTags({ cuisine: "ordinary", mealTypes: ["dinner"] }),
    }));
    const candidates = [
      ...ordinaryDinners,
      {
        authorityToken: candidateAuthorityToken(900),
        importId: candidateId(900),
        tags: candidateTags({
          cuisine: "preferred",
          mealTypes: ["dinner"],
        }),
      },
      {
        authorityToken: candidateAuthorityToken(901),
        importId: candidateId(901),
        tags: candidateTags({
          cuisine: "ordinary",
          mealTypes: ["breakfast"],
        }),
      },
    ];

    let frontier = makeMealPlanCandidateFrontier({ policy, request });
    for (let offset = 0; offset < candidates.length; offset += 17) {
      frontier = addMealPlanCandidatePage(
        frontier,
        candidates.slice(offset, offset + 17)
      );
    }
    frontier = addMealPlanCandidatePage(frontier, [
      ...candidates.slice(0, 1),
      ...candidates.slice(0, 1),
    ]);
    const selection = selectMealPlanCandidates(frontier);
    const actual = request.slots.map((slot) => {
      const assignment = selection.assignments.find(
        (candidateAssignment) => candidateAssignment.slot.slotId === slot.slotId
      );
      return assignment === undefined
        ? { slotId: slot.slotId }
        : {
            importId: assignment.importId,
            slotId: assignment.slot.slotId,
          };
    });

    expect(actual).toEqual(
      referenceCandidateSelection({ candidates, policy, request })
    );
    expect(actual).toEqual([
      { importId: candidateId(900), slotId: "dinner-one" },
      { importId: candidateId(1), slotId: "dinner-two" },
      { importId: candidateId(901), slotId: "breakfast-one" },
      { importId: candidateId(2), slotId: "dinner-three" },
      { slotId: "lunch-gap" },
    ]);
    expect(selection.gaps).toEqual([
      {
        reason: "no_eligible_approved_recipe",
        slotId: "lunch-gap",
      },
    ]);
    const retainedCandidates = frontier.rankedCandidatesBySlot.flat();
    expect(retainedCandidates.length).toBeLessThanOrEqual(
      request.slots.length * request.slots.length
    );
    expect(
      retainedCandidates.every(
        (candidate) =>
          Object.keys(candidate).toSorted().join(",") ===
          "authorityToken,importId,preferred"
      )
    ).toBe(true);
    expect(
      frontier.rankedCandidatesBySlot.every(
        (rankedCandidates) =>
          new Set(rankedCandidates.map(({ importId }) => importId)).size ===
          rankedCandidates.length
      )
    ).toBe(true);
    expect(JSON.stringify(frontier.rankedCandidatesBySlot)).not.toContain(
      "ordinary"
    );

    const fullProposal = await Effect.runPromise(
      makeDeterministicMealPlanPlanner().plan({
        approvedRecipes: candidates.map(candidateSnapshot),
        policy,
        request,
      })
    );
    expect(
      fullProposal.meals.map(({ sourceRecipe, slotId }) => ({
        importId: sourceRecipe.importId,
        slotId,
      }))
    ).toEqual(actual.filter((result) => "importId" in result));
    expect(fullProposal.gaps).toEqual(selection.gaps);
  });

  it("retains only compact rank facts under the maximum 31-slot bound", () => {
    const request = decodeCandidateRequest({
      requestKey: "candidate-frontier-maximum-bound",
      slots: Array.from({ length: 31 }, (_, index) => ({
        date: `2026-08-${(index + 1).toString().padStart(2, "0")}`,
        mealType: "dinner",
        servings: 2,
        slotId: `bounded-slot-${index + 1}`,
      })),
    });
    const policy = decodeCandidatePolicy({
      allowedDietaryFit: ["household_match"],
      allowedDifficulties: ["easy"],
      allowedTotalTimeBands: ["under_30_minutes"],
      maxRecipeUses: 1,
      preferredCuisines: ["preferred"],
      version: "candidate-frontier-bound-v1",
    });
    const candidates = Array.from({ length: 1000 }, (_, index) => ({
      authorityToken: candidateAuthorityToken(index + 1),
      importId: candidateId(index + 1),
      tags: candidateTags({
        cuisine: `discarded-candidate-tag-${index}`,
        mealTypes: ["dinner"],
      }),
    }));
    let frontier = makeMealPlanCandidateFrontier({ policy, request });
    for (let offset = 0; offset < candidates.length; offset += 23) {
      frontier = addMealPlanCandidatePage(
        frontier,
        candidates.slice(offset, offset + 23)
      );
    }

    const retained = frontier.rankedCandidatesBySlot.flat();
    const encodedFrontier = JSON.stringify(frontier.rankedCandidatesBySlot);
    expect(retained).toHaveLength(31 * 31);
    expect(
      retained.every(
        (candidate) =>
          Object.keys(candidate).toSorted().join(",") ===
          "authorityToken,importId,preferred"
      )
    ).toBe(true);
    expect(
      retained.every(
        ({ authorityToken }) =>
          Object.keys(authorityToken).toSorted().join(",") ===
            "extractionFingerprint,reviewVersion,tagsFingerprint" &&
          authorityToken.extractionFingerprint.length === 64 &&
          authorityToken.tagsFingerprint.length === 64
      )
    ).toBe(true);
    expect(encodedFrontier).not.toContain("discarded-candidate-tag");
    expect(new TextEncoder().encode(encodedFrontier).byteLength).toBeLessThan(
      320_000
    );
  });

  it("preserves shared-candidate usage limits and later-page preferred winners", () => {
    const request = decodeCandidateRequest({
      requestKey: "candidate-frontier-shared-usage",
      slots: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-09-${(index + 1).toString().padStart(2, "0")}`,
        mealType: index === 6 ? "breakfast" : "dinner",
        servings: 2,
        slotId: `slot-${index + 1}`,
      })),
    });
    const policy = decodeCandidatePolicy({
      allowedDietaryFit: ["household_match"],
      allowedDifficulties: ["easy"],
      allowedTotalTimeBands: ["under_30_minutes"],
      maxRecipeUses: 2,
      preferredCuisines: ["preferred"],
      version: "candidate-frontier-v2",
    });
    const candidates = Array.from({ length: 150 }, (_, index) => ({
      authorityToken: candidateAuthorityToken(index + 1),
      importId: candidateId(index + 1),
      tags: candidateTags({ cuisine: "ordinary", mealTypes: ["dinner"] }),
    }));
    candidates.push({
      authorityToken: candidateAuthorityToken(999),
      importId: candidateId(999),
      tags: candidateTags({
        cuisine: "preferred",
        mealTypes: ["breakfast", "dinner"],
      }),
    });

    let frontier = makeMealPlanCandidateFrontier({ policy, request });
    for (const page of [
      candidates.slice(0, 60),
      candidates.slice(60, 120),
      candidates.slice(120),
    ]) {
      frontier = addMealPlanCandidatePage(frontier, page);
    }
    const selection = selectMealPlanCandidates(frontier);

    expect(
      selection.assignments.map(({ importId, slot }) => ({
        importId,
        slotId: slot.slotId,
      }))
    ).toEqual(
      referenceCandidateSelection({ candidates, policy, request }).filter(
        (result) => "importId" in result
      )
    );
    expect(selection.assignments.map(({ importId }) => importId)).toEqual([
      candidateId(999),
      candidateId(999),
      candidateId(1),
      candidateId(1),
      candidateId(2),
      candidateId(2),
    ]);
    expect(selection.gaps).toEqual([
      {
        reason: "no_eligible_approved_recipe",
        slotId: "slot-7",
      },
    ]);
  });

  it("preserves the first observed authority token for duplicate candidate versions", () => {
    const request = decodeCandidateRequest({
      requestKey: "candidate-frontier-authority-token",
      slots: [
        {
          date: "2026-09-08",
          mealType: "dinner",
          servings: 2,
          slotId: "authority-slot",
        },
      ],
    });
    const policy = decodeCandidatePolicy({
      allowedDietaryFit: ["household_match"],
      allowedDifficulties: ["easy"],
      allowedTotalTimeBands: ["under_30_minutes"],
      maxRecipeUses: 1,
      preferredCuisines: ["preferred"],
      version: "candidate-frontier-authority-v1",
    });
    const importId = candidateId(777);
    const firstAuthorityToken = candidateAuthorityToken(777, 0);
    const changedAuthorityToken = candidateAuthorityToken(778, 1);
    const firstPage = [
      {
        authorityToken: firstAuthorityToken,
        importId,
        tags: candidateTags({ cuisine: "ordinary", mealTypes: ["dinner"] }),
      },
    ];
    const changedVersionPage = [
      {
        authorityToken: changedAuthorityToken,
        importId,
        tags: candidateTags({ cuisine: "preferred", mealTypes: ["dinner"] }),
      },
    ];

    const frontier = addMealPlanCandidatePage(
      addMealPlanCandidatePage(
        makeMealPlanCandidateFrontier({ policy, request }),
        firstPage
      ),
      changedVersionPage
    );

    expect(frontier.rankedCandidatesBySlot).toEqual([
      [{ authorityToken: firstAuthorityToken, importId, preferred: false }],
    ]);
    expect(selectMealPlanCandidates(frontier).assignments).toEqual([
      {
        authorityToken: firstAuthorityToken,
        importId,
        slot: request.slots[0],
      },
    ]);
  });
});

describe("provider-free meal-plan tracer", () => {
  it("uses the shared recipe snapshot contract at the review boundary", async () => {
    expect(MealPlanRecipeSnapshot).toBe(SharedMealPlanRecipeSnapshot);

    const { recipeRepository } = makeSyntheticMealPlanTracer();
    const snapshots = await Effect.runPromise(recipeRepository.listApproved());

    expect(snapshots).toHaveLength(3);
    const isMealPlanRecipeSnapshot = Schema.is(MealPlanRecipeSnapshot);
    expect(
      snapshots.every((snapshot) => isMealPlanRecipeSnapshot(snapshot))
    ).toBe(true);
    expect(
      snapshots.some(({ importId }) => importId === syntheticRejectedRecipeId)
    ).toBe(false);
  });

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

    const maximumRequestKey = "a".repeat(128);
    const boundaryDraft = await Effect.runPromise(
      makeSyntheticMealPlanTracer().service.create(
        Schema.decodeUnknownSync(MealPlanRequest)({
          requestKey: maximumRequestKey,
          slots: [
            {
              date: "2026-07-27",
              mealType: "dinner",
              servings: 2,
              slotId: "synthetic-boundary-dinner",
            },
          ],
        }),
        syntheticPlanningPolicy
      )
    );
    expect(boundaryDraft.draftId).toBe(`draft-${maximumRequestKey}`);
    expect(() =>
      Schema.decodeUnknownSync(MealPlanRequest)({
        requestKey: "a".repeat(129),
        slots: [
          {
            date: "2026-07-27",
            mealType: "dinner",
            servings: 2,
            slotId: "synthetic-adjacent-boundary-dinner",
          },
        ],
      })
    ).toThrow();
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
    const replay = await Effect.runPromise(
      tracer.service.swap(
        decodeSwap({
          ...request,
          swappedAt: "2026-07-22T10:05:00.000Z",
        })
      )
    );

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
    expect(swapped.audit[0]?.swappedAt).toEqual(request.swappedAt);

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
      tracer.service.approve(
        decodeDecision({
          ...approve,
          decidedAt: "2026-07-22T10:06:00.000Z",
        })
      )
    );
    expect(approved).toEqual(approveReplay);
    expect(approved).toMatchObject({ _tag: "Approved", revision: 1 });
    expect(approved.decision.decidedAt).toEqual(approve.decidedAt);

    const changedDecisionIntent = await Effect.runPromise(
      Effect.flip(
        tracer.service.approve(
          decodeDecision({
            ...approve,
            decidedAt: "2026-07-22T10:06:00.000Z",
            reason: "A materially different approval reason.",
          })
        )
      )
    );
    expect(changedDecisionIntent).toMatchObject({
      _tag: "MealPlanMutationConflict",
      mutationId: "approve-synthetic-draft",
    });

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
