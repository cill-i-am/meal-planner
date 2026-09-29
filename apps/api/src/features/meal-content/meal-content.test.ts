import {
  HouseholdPersonId,
  MealOccasionId,
  MutatePlanningContentPayload,
  PlanningContentId,
  PlanningContentMutationId,
  PlanningContentSnapshot,
  PlanningContentVersion,
  PlanningDate,
  PlanningOptionVersion,
  ProfileVersion,
} from "@meal-planner/household-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  expandManagedOccasions,
  resolveFallbackForCoverage,
  resolveRoutineForCoverage,
} from "../meal-routines/index.js";
import {
  applyPlanningContentCommand,
  contentSuitabilityIssue,
  emptyPlanningContentSnapshot,
  isShoppingResolved,
  optionPreparationIssue,
} from "./index.js";

const personId = HouseholdPersonId.make(
  "person_123e4567-e89b-42d3-a456-426614174000"
);
const optionId = PlanningContentId.make("option_001");
const optionRef = {
  kind: "packaged" as const,
  optionId,
  optionVersion: PlanningOptionVersion.make(1),
};
const occasionId = MealOccasionId.make("breakfast");
const profileVersion = ProfileVersion.make(3);
const authority = {
  activePersonIds: new Set([personId]),
  actorId: "a".repeat(64),
  profileVersions: new Map([[personId, profileVersion]]),
  today: PlanningDate.make("2026-10-06"),
};
const readyPreparation = {
  attention: "low" as const,
  cleanup: "low" as const,
  elapsedTime: { _tag: "Known" as const, minutes: 0 },
  handsOnTime: { _tag: "Known" as const, minutes: 0 },
  requiredEquipment: [],
  startRequirement: "none" as const,
  substantialCookEvent: "no" as const,
};
const packaged = {
  ...optionRef,
  cover: null,
  label: "Plain cereal",
  preparation: readyPreparation,
  productIdentity: "Box 123",
  productName: "Plain cereal",
  quantity: {
    _tag: "Known" as const,
    amount: 1,
    sourceText: null,
    unit: "pack" as const,
  },
  substitutionPolicy: "exact_only" as const,
};

const command = (
  snapshot: ReturnType<typeof emptyPlanningContentSnapshot>,
  value: MutatePlanningContentPayload["command"]
) =>
  MutatePlanningContentPayload.make({
    command: value,
    expectedVersion: snapshot.configVersion,
    mutationId: PlanningContentMutationId.make("mutation_001"),
  });

describe("planning content authority", () => {
  it("changes one person's managed occasions without erasing another person's coverage", () => {
    const otherPersonId = HouseholdPersonId.make(
      "person_223e4567-e89b-42d3-a456-426614174000"
    );
    const current = PlanningContentSnapshot.make({
      ...emptyPlanningContentSnapshot(),
      managedOccasions: [
        {
          label: "Breakfast",
          occasionId,
          personId,
          state: "managed",
          weekdays: [1],
        },
        {
          label: "Breakfast",
          occasionId,
          personId: otherPersonId,
          state: "managed",
          weekdays: [1],
        },
      ],
    });
    const next = applyPlanningContentCommand(
      current,
      command(current, {
        _tag: "SetPersonManagedOccasions",
        entries: [
          {
            label: "Breakfast",
            occasionId,
            personId,
            state: "managed",
            weekdays: [2],
          },
        ],
        personId,
      }),
      {
        ...authority,
        activePersonIds: new Set([personId, otherPersonId]),
      }
    );
    expect("_tag" in next).toBe(false);
    if ("_tag" in next) {
      return;
    }
    expect(next.managedOccasions).toHaveLength(2);
    expect(
      next.managedOccasions.find((entry) => entry.personId === otherPersonId)
        ?.weekdays
    ).toEqual([1]);
  });

  it("keeps other people's availability when one person's location changes", () => {
    const otherPersonId = HouseholdPersonId.make(
      "person_223e4567-e89b-42d3-a456-426614174000"
    );
    const forPerson = (id: typeof personId, location: "home" | "school") => ({
      handsOffStart: "available" as const,
      location,
      occasionId,
      personId: id,
      preparationWindowMinutes: 30,
      weekdays: [1] as const,
    });
    const current = PlanningContentSnapshot.make({
      ...emptyPlanningContentSnapshot(),
      availability: [
        forPerson(personId, "home"),
        forPerson(otherPersonId, "school"),
      ],
    });
    const next = applyPlanningContentCommand(
      current,
      command(current, {
        _tag: "SetPersonAvailability",
        entries: [forPerson(personId, "school")],
        personId,
      }),
      {
        ...authority,
        activePersonIds: new Set([personId, otherPersonId]),
      }
    );
    expect("_tag" in next).toBe(false);
    if ("_tag" in next) {
      return;
    }
    expect(next.availability).toHaveLength(2);
    expect(
      next.availability.find((entry) => entry.personId === otherPersonId)
        ?.location
    ).toBe("school");
  });

  it("rejects stale versioned content and stale profile suitability reviews", () => {
    const empty = emptyPlanningContentSnapshot();
    const withOption = applyPlanningContentCommand(
      empty,
      command(empty, { _tag: "PutOption", value: packaged }),
      authority
    );
    expect("_tag" in withOption).toBe(false);
    if ("_tag" in withOption) {
      return;
    }

    const stale = applyPlanningContentCommand(
      withOption,
      command(empty, {
        _tag: "PutOption",
        value: { ...packaged, optionVersion: PlanningOptionVersion.make(2) },
      }),
      authority
    );
    expect(stale).toMatchObject({
      _tag: "PlanningContentRejected",
      reason: "stale_version",
    });

    const review = {
      confirmation: "I reviewed this food for this person" as const,
      id: PlanningContentId.make("review_001"),
      optionRef,
      personId,
      profileVersion: ProfileVersion.make(2),
      reason: "Adult reviewed this exact product",
      status: "compatible" as const,
      version: 1,
    };
    const rejectedReview = applyPlanningContentCommand(
      withOption,
      command(withOption, { _tag: "PutSuitabilityReview", value: review }),
      authority
    );
    expect(rejectedReview).toMatchObject({
      _tag: "PlanningContentRejected",
      reason: "stale_profile",
    });
    const acceptedReview = applyPlanningContentCommand(
      withOption,
      command(withOption, {
        _tag: "PutSuitabilityReview",
        value: { ...review, profileVersion },
      }),
      authority
    );
    expect("_tag" in acceptedReview).toBe(false);
    if ("_tag" in acceptedReview) {
      return;
    }
    expect(acceptedReview.suitabilityReviews[0]).toMatchObject({
      confirmedByActorId: authority.actorId,
      status: "compatible",
    });
    expect(
      contentSuitabilityIssue(withOption, {
        optionRef,
        personId,
        profileVersion,
        safetyState: "has_constraints",
      })
    ).toBe("unreviewed");
  });

  it("pauses stale saved rules without rewriting them, while reactivation checks current facts", () => {
    const routine = {
      choice: {
        _tag: "Options" as const,
        optionRefs: [optionRef] as const,
        selection: "pin" as const,
      },
      id: PlanningContentId.make("routine_stale"),
      occasionId,
      scope: { _tag: "Person" as const, personId },
      state: "active" as const,
      version: 1,
      weekdays: [1] as const,
    };
    const fallback = {
      id: PlanningContentId.make("fallback_stale"),
      locations: ["home" as const],
      occasionIds: [occasionId],
      optionRef,
      personId,
      priority: 1,
      state: "active" as const,
      substitutionPolicy: "exact_only" as const,
      version: 1,
    };
    const current = PlanningContentSnapshot.make({
      ...emptyPlanningContentSnapshot(),
      fallbacks: [fallback],
      managedOccasions: [
        {
          label: "Breakfast",
          occasionId,
          personId,
          state: "managed",
          weekdays: [1],
        },
      ],
      options: [{ ...packaged, optionVersion: PlanningOptionVersion.make(2) }],
      routines: [routine],
    });
    const archivedAuthority = {
      ...authority,
      activePersonIds: new Set<typeof personId>(),
    };
    const pausedRoutine = applyPlanningContentCommand(
      current,
      command(current, {
        _tag: "PutRoutine",
        value: { ...routine, state: "paused", version: 2 },
      }),
      archivedAuthority
    );
    expect("_tag" in pausedRoutine).toBe(false);
    if ("_tag" in pausedRoutine) {
      return;
    }
    expect(pausedRoutine.routines[0]).toMatchObject({
      choice: routine.choice,
      state: "paused",
      version: 2,
    });
    const activeRoutine = applyPlanningContentCommand(
      pausedRoutine,
      command(pausedRoutine, {
        _tag: "PutRoutine",
        value: { ...routine, state: "active", version: 3 },
      }),
      authority
    );
    expect(activeRoutine).toMatchObject({
      _tag: "PlanningContentRejected",
      reason: "stale_option",
    });
    const changedPause = applyPlanningContentCommand(
      current,
      command(current, {
        _tag: "PutRoutine",
        value: {
          ...routine,
          choice: { _tag: "Skip" },
          state: "paused",
          version: 2,
        },
      }),
      archivedAuthority
    );
    expect(changedPause).toMatchObject({
      _tag: "PlanningContentRejected",
      reason: "invalid_transition",
    });
    const newPause = applyPlanningContentCommand(
      current,
      command(current, {
        _tag: "PutRoutine",
        value: {
          ...routine,
          id: PlanningContentId.make("new_pause"),
          state: "paused",
        },
      }),
      archivedAuthority
    );
    expect(newPause).toMatchObject({
      _tag: "PlanningContentRejected",
      reason: "invalid_transition",
    });

    const unavailable = applyPlanningContentCommand(
      current,
      command(current, {
        _tag: "PutFallback",
        value: { ...fallback, state: "unavailable", version: 2 },
      }),
      archivedAuthority
    );
    expect("_tag" in unavailable).toBe(false);
    if ("_tag" in unavailable) {
      return;
    }
    const activeFallback = applyPlanningContentCommand(
      unavailable,
      command(unavailable, {
        _tag: "PutFallback",
        value: { ...fallback, state: "active", version: 3 },
      }),
      authority
    );
    expect(activeFallback).toMatchObject({
      _tag: "PlanningContentRejected",
      reason: "stale_option",
    });
    const changedFallback = applyPlanningContentCommand(
      current,
      command(current, {
        _tag: "PutFallback",
        value: { ...fallback, priority: 2, state: "paused", version: 2 },
      }),
      archivedAuthority
    );
    expect(changedFallback).toMatchObject({
      _tag: "PlanningContentRejected",
      reason: "invalid_transition",
    });
  });

  it("expands managed days and exposes equal-priority routine conflicts", () => {
    const snapshot = PlanningContentSnapshot.make({
      ...emptyPlanningContentSnapshot(),
      managedOccasions: [
        {
          label: "Breakfast",
          occasionId,
          personId,
          state: "managed" as const,
          weekdays: [1, 2, 3, 4, 5],
        },
      ],
      options: [packaged],
      routines: [
        {
          choice: { _tag: "Skip" as const },
          id: PlanningContentId.make("routine_001"),
          occasionId,
          scope: { _tag: "Person" as const, personId },
          state: "active" as const,
          version: 1,
          weekdays: [1],
        },
        {
          choice: {
            _tag: "Options" as const,
            optionRefs: [optionRef] as const,
            selection: "pin" as const,
          },
          id: PlanningContentId.make("routine_002"),
          occasionId,
          scope: { _tag: "Person" as const, personId },
          state: "active" as const,
          version: 1,
          weekdays: [1],
        },
      ],
    });
    const requirements = expandManagedOccasions(
      snapshot,
      new Set([personId]),
      PlanningDate.make("2026-09-28"),
      1
    );
    expect(requirements).toHaveLength(5);
    const [firstRequirement] = requirements;
    if (firstRequirement === undefined) {
      throw new Error("Expected a managed breakfast requirement");
    }
    expect(
      resolveRoutineForCoverage(snapshot, {
        profileVersion,
        requirement: firstRequirement,
        safetyState: "has_constraints",
      })
    ).toMatchObject({ _tag: "Conflict", scope: "person" });
  });

  it("excludes an unavailable exact fallback and rejects over-reserved stock", () => {
    const snapshot = PlanningContentSnapshot.make({
      ...emptyPlanningContentSnapshot(),
      fallbacks: [
        {
          id: PlanningContentId.make("fallback_001"),
          locations: ["school" as const],
          occasionIds: [occasionId],
          optionRef,
          personId,
          priority: 1,
          state: "unavailable" as const,
          substitutionPolicy: "exact_only" as const,
          version: 1,
        },
      ],
      options: [packaged],
    });
    expect(
      resolveFallbackForCoverage(snapshot, {
        location: "school",
        occasionId,
        personId,
        profileVersion,
        safetyState: "confirmed_none",
      })
    ).toEqual({ _tag: "None" });

    const portionWrite = {
      confirmedForWeekStart: PlanningDate.make("2026-09-28"),
      id: PlanningContentId.make("portion_001"),
      label: "Prepared rice",
      quantity: {
        _tag: "Known" as const,
        amount: 2,
        sourceText: null,
        unit: "portion" as const,
      },
      reason: "Recorded prepared rice",
      remainingAmount: 1,
      sourceCookEventId: null,
      sourceOptionRef: null,
      state: "available" as const,
      storage: "fridge" as const,
      version: 1,
    };
    expect(() =>
      Schema.decodeUnknownSync(MutatePlanningContentPayload)({
        command: {
          _tag: "PutPreparedPortion",
          value: { ...portionWrite, reservations: [] },
        },
        expectedVersion: 0,
        mutationId: "mutation_002",
      })
    ).toThrow();
    const withReservation = PlanningContentSnapshot.make({
      ...emptyPlanningContentSnapshot(),
      configVersion: PlanningContentVersion.make(1),
      options: [packaged],
      preparedPortions: [
        {
          ...portionWrite,
          lastCorrectionReason: portionWrite.reason,
          reservations: [
            {
              amount: 1,
              coverageKey: "p:2026-09-28:lunch",
              date: PlanningDate.make("2026-09-28"),
              planId: "plan_001",
              weekStart: PlanningDate.make("2026-09-28"),
            },
          ],
          state: "reserved",
        },
      ],
    });
    const bad = applyPlanningContentCommand(
      withReservation,
      command(withReservation, {
        _tag: "PutPreparedPortion",
        value: { ...portionWrite, remainingAmount: 0.5, version: 2 },
      }),
      authority
    );
    expect(bad).toMatchObject({
      _tag: "PlanningContentRejected",
      reason: "quantity_exceeded",
    });
    const changedSource = applyPlanningContentCommand(
      withReservation,
      command(withReservation, {
        _tag: "PutPreparedPortion",
        value: { ...portionWrite, sourceOptionRef: optionRef, version: 2 },
      }),
      authority
    );
    expect(changedSource).toMatchObject({
      _tag: "PlanningContentRejected",
      reason: "invalid_transition",
    });
    const carried = applyPlanningContentCommand(
      withReservation,
      command(withReservation, {
        _tag: "ConfirmPreparedCarryOver",
        value: {
          confirmation: "I confirm this prepared food still exists",
          confirmedForWeekStart: PlanningDate.make("2026-10-05"),
          expectedPortionVersion: 1,
          id: portionWrite.id,
          reason: "Confirmed rice still in the freezer",
          remainingAmount: 0.5,
        },
      }),
      authority
    );
    expect("_tag" in carried).toBe(false);
    if ("_tag" in carried) {
      return;
    }
    expect(carried.preparedPortions[0]).toMatchObject({
      confirmedForWeekStart: "2026-10-05",
      remainingAmount: 0.5,
      reservations: [],
      state: "available",
    });
  });

  it("keeps recipe shopping unresolved until yield and quantities are reviewed", () => {
    const recipe = {
      cover: null,
      kind: "recipe" as const,
      label: "Rice bowls",
      optionId: PlanningContentId.make("recipe_001"),
      optionVersion: PlanningOptionVersion.make(1),
      preparation: readyPreparation,
      recipeId: "123e4567-e89b-42d3-a456-426614174002",
      recipeImportId: "123e4567-e89b-42d3-a456-426614174001",
      recipeVersion: 1,
      shoppingComponents: [
        {
          name: "Rice",
          quantity: { _tag: "Unresolved" as const, sourceText: "some rice" },
          substitutionPolicy: "similar_acceptable" as const,
        },
      ],
      shoppingStatus: "unresolved" as const,
      yield: { _tag: "Unresolved" as const, sourceText: "serves several" },
    };
    expect(isShoppingResolved(recipe)).toBe(false);
    expect(
      isShoppingResolved({
        ...recipe,
        shoppingComponents: [
          {
            name: "Rice",
            quantity: {
              _tag: "Known",
              amount: 300,
              sourceText: "300 g",
              unit: "g",
            },
            substitutionPolicy: "similar_acceptable",
          },
        ],
        shoppingStatus: "reviewed",
        yield: {
          _tag: "Known",
          amount: 4,
          sourceText: "serves four",
          unit: "portion",
        },
      })
    ).toBe(true);
  });

  it("requires known preparation windows and equipment for an ordinary meal", () => {
    const option = {
      ...packaged,
      preparation: {
        ...readyPreparation,
        elapsedTime: { _tag: "Known" as const, minutes: 45 },
        handsOnTime: { _tag: "Known" as const, minutes: 10 },
        requiredEquipment: ["Oven"],
        startRequirement: "during_window" as const,
      },
    };
    const availability = {
      handsOffStart: "unavailable" as const,
      location: "home" as const,
      occasionId,
      personId,
      preparationWindowMinutes: 30,
      weekdays: [1] as const,
    };
    expect(
      optionPreparationIssue(option, availability, {
        availableEquipment: [],
        maximumSubstantialCookEventsPerWeek: 2,
      })
    ).toBe("missing_equipment");
    expect(
      optionPreparationIssue(option, availability, {
        availableEquipment: ["oven"],
        maximumSubstantialCookEventsPerWeek: 2,
      })
    ).toBe("preparation_window_conflict");
  });
});
