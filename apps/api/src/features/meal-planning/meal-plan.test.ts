import { describe, expect, it } from "@effect/vitest";
import {
  MealPlanActorId,
  MealPlanInstant,
  MealPlanMutationId,
  MealPlanPersonPin,
  MealPlanRequest,
  MealPlanResolution,
  MealPlanVersion,
  PlanningContentSnapshot,
  PlanningContentVersion,
  PlanningOptionRef,
  PlanningOptionVersion,
} from "@meal-planner/household-api";
import type {
  MealPlan,
  MealPlanCoverage,
  MealPlanId,
} from "@meal-planner/household-api";
import { Effect, Option, Schema } from "effect";

import { makeMealPlanService } from "./meal-plan.js";
import type { MealPlanRepository } from "./meal-plan.js";
import {
  changePlanVersion,
  makeInitialPlanVersion,
  repinPlanVersion,
  requiredCoverage,
  validatePlanVersion,
} from "./planning-kernel.js";
import type { PlanningAuthority } from "./planning-kernel.js";

const adultId = "person_11111111-1111-4111-8111-111111111111";
const childId = "person_22222222-2222-4222-8222-222222222222";
const cereal = {
  kind: "packaged",
  optionId: "option_cereal",
  optionVersion: 1,
};
const roast = { kind: "recipe", optionId: "option_roast", optionVersion: 1 };
const allWeekdays = [0, 1, 2, 3, 4, 5, 6];
const readyPreparation = {
  attention: "low",
  cleanup: "low",
  elapsedTime: { _tag: "Known", minutes: 0 },
  handsOnTime: { _tag: "Known", minutes: 0 },
  requiredEquipment: [],
  startRequirement: "none",
  substantialCookEvent: "no",
};
const roastPreparation = {
  attention: "moderate",
  cleanup: "moderate",
  elapsedTime: { _tag: "Known", minutes: 45 },
  handsOnTime: { _tag: "Known", minutes: 20 },
  requiredEquipment: ["oven"],
  startRequirement: "during_window",
  substantialCookEvent: "yes",
};
const decodeRequest = Schema.decodeUnknownSync(MealPlanRequest);
const decodeResolution = Schema.decodeUnknownSync(MealPlanResolution);
const actorId = Schema.decodeUnknownSync(MealPlanActorId)("adult_actor_1");
const at = Schema.decodeUnknownSync(MealPlanInstant)(
  "2026-09-28T10:00:00.000Z"
);
const decodeMutationId = (value: string) =>
  Schema.decodeUnknownSync(MealPlanMutationId)(value);

const authority = (
  input: {
    readonly weeks?: number;
    readonly childReview?: "compatible" | "incompatible" | "unknown";
    readonly twoPeople?: boolean;
    readonly allOccasions?: boolean;
    readonly withRoutine?: boolean;
    readonly recipeResolved?: boolean;
    readonly stockConfirmedFor?: string;
    readonly stockSourceOption?: "roast" | "none";
    readonly childReviewOption?: "cereal" | "roast";
  } = {}
): PlanningAuthority => {
  const people = [
    Schema.decodeUnknownSync(MealPlanPersonPin)({
      personId: adultId,
      profileVersion: 1,
      safetyState: "confirmed_none",
    }),
    ...(input.twoPeople
      ? [
          Schema.decodeUnknownSync(MealPlanPersonPin)({
            personId: childId,
            profileVersion: 1,
            safetyState: "has_constraints",
          }),
        ]
      : []),
  ];
  const occasionNames = input.allOccasions
    ? ["breakfast", "lunch", "dinner", "snack"]
    : ["breakfast"];
  const content = Schema.decodeUnknownSync(PlanningContentSnapshot)({
    availability: people.flatMap(({ personId }) =>
      occasionNames.map((name) => ({
        handsOffStart: "available",
        location: "home",
        occasionId: `occasion_${name}`,
        personId,
        preparationWindowMinutes: 60,
        weekdays: allWeekdays,
      }))
    ),
    configVersion: 1,
    cookingCapacity: {
      availableEquipment: ["oven"],
      maximumSubstantialCookEventsPerWeek: 7,
    },
    fallbacks: [],
    managedOccasions: people.flatMap(({ personId }) =>
      occasionNames.map((name) => ({
        label: name,
        occasionId: `occasion_${name}`,
        personId,
        state: "managed",
        weekdays: allWeekdays,
      }))
    ),
    oneOffRoutines: [],
    options: [
      {
        ...cereal,
        cover: null,
        label: "Cereal",
        preparation: readyPreparation,
        productIdentity: null,
        productName: "Cereal",
        quantity: { _tag: "Known", amount: 1, sourceText: null, unit: "item" },
        substitutionPolicy: "exact_only",
      },
      {
        ...roast,
        cover: null,
        label: "Roast dinner",
        preparation: roastPreparation,
        recipeId: "018f47ad-91aa-7c35-b6fe-000000000401",
        recipeImportId: "018f47ad-91aa-7c35-b6fe-000000000401",
        recipeVersion: 1,
        shoppingComponents: input.recipeResolved
          ? [
              {
                name: "potato",
                quantity: {
                  _tag: "Known",
                  amount: 500,
                  sourceText: null,
                  unit: "g",
                },
                substitutionPolicy: "similar_acceptable",
              },
            ]
          : [],
        shoppingStatus: input.recipeResolved ? "reviewed" : "unresolved",
        yield: input.recipeResolved
          ? { _tag: "Known", amount: 2, sourceText: null, unit: "portion" }
          : { _tag: "Unresolved", sourceText: "yield not given" },
      },
    ],
    preparedPortions: input.stockConfirmedFor
      ? [
          {
            confirmedForWeekStart: input.stockConfirmedFor,
            id: "stock_portion_1",
            label: "Prepared lunch",
            lastCorrectionReason: "Adult confirmed this portion.",
            quantity: {
              _tag: "Known",
              amount: 2,
              sourceText: null,
              unit: "portion",
            },
            remainingAmount: 2,
            reservations: [],
            sourceCookEventId: null,
            sourceOptionRef: input.stockSourceOption === "roast" ? roast : null,
            state: "available",
            storage: "freezer",
            version: 1,
          },
        ]
      : [],
    routines: input.withRoutine
      ? [
          {
            choice: { _tag: "Options", optionRefs: [cereal], selection: "pin" },
            id: "routine_breakfast",
            occasionId: "occasion_breakfast",
            scope: { _tag: "Household" },
            state: "active",
            version: 1,
            weekdays: allWeekdays,
          },
        ]
      : [],
    suitabilityReviews: input.childReview
      ? [
          {
            confirmedByActorId: "adult_actor_1",
            id: "review_cereal",
            optionRef: input.childReviewOption === "roast" ? roast : cereal,
            personId: childId,
            profileVersion: 1,
            reason: "Reviewed ingredients",
            status: input.childReview,
            version: 1,
          },
        ]
      : [],
  });
  return { content, people };
};

const request = (weeks = 1) =>
  decodeRequest({
    requestKey: `week_${weeks}_family`,
    startDate: "2026-09-28",
    weeks,
  });

const flexibleCoverage = (
  planRequest: ReturnType<typeof request>,
  context: PlanningAuthority
): MealPlanCoverage[] =>
  requiredCoverage(planRequest, context).map((requirement) => ({
    requirement,
    resolution: decodeResolution({
      _tag: "Flexible",
      rationale: "Adult chose a flexible meal.",
    }),
  }));

describe("family meal planning domain", () => {
  it("expands twelve weeks for every person and managed occasion", () => {
    const context = authority({ allOccasions: true, twoPeople: true });
    const entries = requiredCoverage(request(12), context);
    expect(entries).toHaveLength(12 * 7 * 4 * 2);
    expect(
      new Set(
        entries.map(
          (entry) => `${entry.personId}:${entry.date}:${entry.occasion}`
        )
      ).size
    ).toBe(entries.length);
    expect(entries.some((entry) => entry.date === "2026-12-20")).toBe(true);
  });

  it("applies a shared routine only to people with suitable current content", () => {
    const planRequest = request();
    const blocked = makeInitialPlanVersion(
      planRequest,
      authority({ twoPeople: true, withRoutine: true })
    );
    expect(
      blocked.coverage.filter(
        ({ resolution }) => resolution._tag === "MealOption"
      )
    ).toHaveLength(7);
    expect(
      blocked.coverage.filter(
        ({ resolution }) =>
          resolution._tag === "Gap" &&
          resolution.reason === "unconfirmed_suitability"
      )
    ).toHaveLength(7);
    const reviewed = makeInitialPlanVersion(
      planRequest,
      authority({
        childReview: "compatible",
        twoPeople: true,
        withRoutine: true,
      })
    );
    expect(
      reviewed.coverage.every(
        ({ resolution }) => resolution._tag === "MealOption"
      )
    ).toBe(true);
    expect(
      validatePlanVersion(
        reviewed,
        planRequest,
        authority({
          childReview: "compatible",
          twoPeople: true,
          withRoutine: true,
        }),
        false
      )
    ).toBeNull();
  });

  it("cannot approve an unresolved gap or an incompatible option", () => {
    const planRequest = request();
    const context = authority({ twoPeople: true });
    const draft = makeInitialPlanVersion(planRequest, context);
    expect(validatePlanVersion(draft, planRequest, context, true)?.reason).toBe(
      "unresolved_gap"
    );
    const incompatible = authority({
      childReview: "incompatible",
      twoPeople: true,
      withRoutine: true,
    });
    const complete = flexibleCoverage(planRequest, incompatible);
    const childIndex = complete.findIndex(
      ({ requirement }) => requirement.personId === childId
    );
    const childCoverage = complete[childIndex];
    if (childCoverage === undefined) {
      throw new Error("Expected child coverage");
    }
    complete[childIndex] = {
      ...childCoverage,
      resolution: decodeResolution({
        _tag: "MealOption",
        eventId: "event_1",
        option: cereal,
        quantity: null,
        rationale: "Adult proposal.",
      }),
    };
    const proposed = makeInitialPlanVersion(
      planRequest,
      incompatible,
      complete
    );
    expect(
      validatePlanVersion(proposed, planRequest, incompatible, true)?.reason
    ).toBe("incompatible_option");
  });

  it("repairs a meal dependent on removed adult-confirmed cook output", () => {
    const planRequest = request();
    const context = authority();
    const coverage = flexibleCoverage(planRequest, context);
    const second = coverage.at(1);
    if (second === undefined) {
      throw new Error("Expected a second coverage entry");
    }
    coverage[1] = {
      ...second,
      resolution: decodeResolution({
        _tag: "Prepared",
        outputId: "output_roast",
        quantity: { amount: 1, unit: "portion" },
        rationale: "Planned leftover.",
      }),
    };
    const initial = makeInitialPlanVersion(planRequest, context, coverage);
    const withCook = changePlanVersion(
      initial,
      {
        _tag: "SetCookEvent",
        event: {
          batchCount: 1,
          date: planRequest.startDate,
          eventId: "event_roast",
          option: Schema.decodeUnknownSync(PlanningOptionRef)(roast),
          outputs: [
            {
              outputId: "output_roast",
              quantity: { amount: 2, unit: "portion" },
              source: "adult_confirmed",
            },
          ],
        },
      },
      planRequest,
      context
    );
    expect("_tag" in withCook).toBe(false);
    if ("_tag" in withCook) {
      return;
    }
    const removed = changePlanVersion(
      withCook.version,
      { _tag: "RemoveCookEvent", eventId: "event_roast" },
      planRequest,
      context
    );
    expect("_tag" in removed).toBe(false);
    if ("_tag" in removed) {
      return;
    }
    expect(removed.changed).toHaveLength(1);
    expect(removed.version.coverage[1]?.resolution).toMatchObject({
      _tag: "Gap",
      reason: "dependent_output_removed",
    });
  });

  it("requires reviewed quantities and rejects an event that exceeds its batch yield", () => {
    const planRequest = request();
    const context = authority({ recipeResolved: true });
    const coverage = flexibleCoverage(planRequest, context);
    const [first] = coverage;
    if (first === undefined) {
      throw new Error("Expected breakfast coverage");
    }
    coverage[0] = {
      ...first,
      resolution: decodeResolution({
        _tag: "MealOption",
        eventId: "event_roast",
        option: roast,
        quantity: null,
        rationale: "Proposed roast.",
      }),
    };
    const incomplete = makeInitialPlanVersion(planRequest, context, coverage);
    expect(
      validatePlanVersion(incomplete, planRequest, context, true)?.reason
    ).toBe("unresolved_allocation");
    coverage[0] = {
      ...first,
      resolution: decodeResolution({
        _tag: "MealOption",
        eventId: "event_roast",
        option: roast,
        quantity: { amount: 3, unit: "portion" },
        rationale: "Proposed roast.",
      }),
    };
    const excessive = makeInitialPlanVersion(planRequest, context, coverage);
    expect(
      validatePlanVersion(excessive, planRequest, context, true)?.reason
    ).toBe("prepared_overallocated");
    const orphanOutput = changePlanVersion(
      makeInitialPlanVersion(
        planRequest,
        context,
        flexibleCoverage(planRequest, context)
      ),
      {
        _tag: "SetCookEvent",
        event: {
          batchCount: 1,
          date: planRequest.startDate,
          eventId: "event_extra",
          option: Schema.decodeUnknownSync(PlanningOptionRef)(roast),
          outputs: [
            {
              outputId: "output_extra",
              quantity: { amount: 3, unit: "portion" },
              source: "adult_confirmed",
            },
          ],
        },
      },
      planRequest,
      context
    );
    expect(orphanOutput).toMatchObject({
      _tag: "MealPlanRuleViolation",
      reason: "prepared_overallocated",
    });
  });

  it("shares one event across person-local occasions while keeping date and yield limits", () => {
    const planRequest = request();
    const base = authority({
      childReview: "compatible",
      childReviewOption: "roast",
      recipeResolved: true,
      twoPeople: true,
    });
    const localOccasion = (personId: string) =>
      personId === adultId ? "adult-dinner" : "child-dinner";
    const context: PlanningAuthority = {
      ...base,
      content: Schema.decodeUnknownSync(PlanningContentSnapshot)({
        ...base.content,
        availability: base.content.availability.map((entry) => ({
          ...entry,
          occasionId: localOccasion(entry.personId),
        })),
        managedOccasions: base.content.managedOccasions.map((entry) => ({
          ...entry,
          occasionId: localOccasion(entry.personId),
        })),
      }),
    };
    const withSharedEvent = (childDate: string, adultAmount: number) => {
      const coverage = flexibleCoverage(planRequest, context).map((entry) => {
        const isAdult =
          entry.requirement.personId === adultId &&
          entry.requirement.date === planRequest.startDate;
        const isChild =
          entry.requirement.personId === childId &&
          entry.requirement.date === childDate;
        return isAdult || isChild
          ? {
              ...entry,
              resolution: decodeResolution({
                _tag: "MealOption",
                eventId: "shared-roast",
                option: roast,
                quantity: {
                  amount: isAdult ? adultAmount : 1,
                  unit: "portion",
                },
                rationale: "One shared dinner cook.",
              }),
            }
          : entry;
      });
      return makeInitialPlanVersion(planRequest, context, coverage);
    };
    const shared = withSharedEvent(planRequest.startDate, 1);
    expect(
      shared.coverage.filter(
        ({ resolution }) =>
          resolution._tag === "MealOption" &&
          resolution.eventId === "shared-roast"
      )
    ).toHaveLength(2);
    expect(validatePlanVersion(shared, planRequest, context, true)).toBeNull();
    expect(
      validatePlanVersion(
        withSharedEvent("2026-09-29", 1),
        planRequest,
        context,
        true
      )?.reason
    ).toBe("cook_event_conflict");
    expect(
      validatePlanVersion(
        withSharedEvent(planRequest.startDate, 2),
        planRequest,
        context,
        true
      )?.reason
    ).toBe("prepared_overallocated");
  });

  it("keeps missing preparation context visible and blocks approval without equipment or capacity", () => {
    const planRequest = request();
    const routineContext = authority({ withRoutine: true });
    const missingAvailability = {
      ...routineContext,
      content: PlanningContentSnapshot.make({
        ...routineContext.content,
        availability: [],
      }),
    };
    const proposed = makeInitialPlanVersion(planRequest, missingAvailability);
    expect(proposed.coverage[0]?.resolution).toMatchObject({
      _tag: "Gap",
      reason: "preparation_context_unresolved",
    });

    const context = authority({ recipeResolved: true });
    const coverage = flexibleCoverage(planRequest, context);
    const [first] = coverage;
    if (first === undefined) {
      throw new Error("Expected breakfast coverage");
    }
    coverage[0] = {
      ...first,
      resolution: decodeResolution({
        _tag: "MealOption",
        eventId: "event_roast",
        option: roast,
        quantity: { amount: 1, unit: "portion" },
        rationale: "Adult chose roast.",
      }),
    };
    const withoutOven = {
      ...context,
      content: PlanningContentSnapshot.make({
        ...context.content,
        cookingCapacity: {
          availableEquipment: [],
          maximumSubstantialCookEventsPerWeek: 7,
        },
      }),
    };
    const ovenPlan = makeInitialPlanVersion(planRequest, withoutOven, coverage);
    expect(
      validatePlanVersion(ovenPlan, planRequest, withoutOven, true)?.reason
    ).toBe("missing_equipment");

    const noCookCapacity = {
      ...context,
      content: PlanningContentSnapshot.make({
        ...context.content,
        cookingCapacity: {
          availableEquipment: ["oven"],
          maximumSubstantialCookEventsPerWeek: 0,
        },
      }),
    };
    const capacityPlan = makeInitialPlanVersion(
      planRequest,
      noCookCapacity,
      coverage
    );
    expect(
      validatePlanVersion(capacityPlan, planRequest, noCookCapacity, true)
        ?.reason
    ).toBe("cooking_capacity_exceeded");
  });

  it("pins option content so an approved week keeps its reviewed food details", () => {
    const planRequest = request();
    const context = authority({ recipeResolved: true });
    const coverage = flexibleCoverage(planRequest, context);
    const [first] = coverage;
    if (first === undefined) {
      throw new Error("Expected breakfast coverage");
    }
    coverage[0] = {
      ...first,
      resolution: decodeResolution({
        _tag: "MealOption",
        eventId: "event_roast",
        option: roast,
        quantity: { amount: 1, unit: "portion" },
        rationale: "Adult chose roast.",
      }),
    };
    const version = makeInitialPlanVersion(planRequest, context, coverage);
    const [pinned] = version.pins.contentSnapshots;
    expect(pinned).toMatchObject({
      kind: "recipe",
      label: "Roast dinner",
      optionVersion: 1,
    });
    const edited = {
      ...context,
      content: PlanningContentSnapshot.make({
        ...context.content,
        configVersion: PlanningContentVersion.make(2),
        options: context.content.options.map((option) =>
          option.kind === "recipe"
            ? {
                ...option,
                label: "New roast title",
                optionVersion: PlanningOptionVersion.make(2),
              }
            : option
        ),
      }),
    };
    expect(version.pins.contentSnapshots[0]).toMatchObject({
      label: "Roast dinner",
    });
    expect(
      validatePlanVersion(version, planRequest, edited, true)?.reason
    ).toBe("config_version_changed");
    expect(
      Schema.decodeUnknownSync(MealPlanVersion)(
        Schema.encodeSync(MealPlanVersion)(version)
      ).pins.contentSnapshots[0]
    ).toMatchObject({ label: "Roast dinner" });
  });

  it("uses stock only in its confirmed week and never before a cook event", () => {
    const planRequest = request(2);
    const context = authority({
      recipeResolved: true,
      stockConfirmedFor: "2026-10-05",
      stockSourceOption: "roast",
    });
    const coverage = flexibleCoverage(planRequest, context);
    const [first] = coverage;
    const nextWeek = coverage.find(
      ({ requirement }) => requirement.date === "2026-10-05"
    );
    if (first === undefined || nextWeek === undefined) {
      throw new Error("Expected both weeks");
    }
    const prepared = decodeResolution({
      _tag: "Prepared",
      outputId: "stock_portion_1",
      quantity: { amount: 1, unit: "portion" },
      rationale: "Confirmed stock.",
    });
    const firstWeekPlan = makeInitialPlanVersion(
      planRequest,
      context,
      coverage.map((entry) =>
        entry === first ? { ...entry, resolution: prepared } : entry
      )
    );
    expect(
      validatePlanVersion(firstWeekPlan, planRequest, context, true)?.reason
    ).toBe("prepared_output_missing");
    const secondWeekPlan = makeInitialPlanVersion(
      planRequest,
      context,
      coverage.map((entry) =>
        entry === nextWeek ? { ...entry, resolution: prepared } : entry
      )
    );
    expect(
      validatePlanVersion(secondWeekPlan, planRequest, context, true)
    ).toBeNull();

    const cookContext = authority({ recipeResolved: true });
    const beforeCook = {
      ...makeInitialPlanVersion(
        request(),
        authority({ recipeResolved: true }),
        flexibleCoverage(request(), authority({ recipeResolved: true }))
      ),
      cookEvents: [
        {
          batchCount: 1,
          date: Schema.decodeUnknownSync(MealPlanRequest)({
            requestKey: "later_cook",
            startDate: "2026-09-29",
            weeks: 1,
          }).startDate,
          eventId: "event_roast",
          option: Schema.decodeUnknownSync(PlanningOptionRef)(roast),
          outputs: [
            {
              outputId: "output_roast",
              quantity: { amount: 1, unit: "portion" },
              source: "adult_confirmed" as const,
            },
          ],
        },
      ],
    };
    const [firstDay] = beforeCook.coverage;
    if (firstDay === undefined) {
      throw new Error("Expected first day");
    }
    const withEarlyLeftover = {
      ...beforeCook,
      coverage: [
        {
          ...firstDay,
          resolution: decodeResolution({
            _tag: "Prepared",
            outputId: "output_roast",
            quantity: { amount: 1, unit: "portion" },
            rationale: "Leftover.",
          }),
        },
        ...beforeCook.coverage.slice(1),
      ],
    };
    expect(
      validatePlanVersion(
        repinPlanVersion(
          Schema.decodeUnknownSync(MealPlanVersion)(withEarlyLeftover),
          cookContext
        ),
        request(),
        cookContext,
        true
      )?.reason
    ).toBe("prepared_output_missing");
  });

  it("requires a known, compatible source for prepared stock assigned to a child", () => {
    const planRequest = request();
    const prepared = decodeResolution({
      _tag: "Prepared",
      outputId: "stock_portion_1",
      quantity: { amount: 1, unit: "portion" },
      rationale: "Adult selected a prepared portion.",
    });
    const planFor = (context: PlanningAuthority) => {
      const coverage = flexibleCoverage(planRequest, context);
      const childEntry = coverage.find(
        ({ requirement }) => requirement.personId === childId
      );
      if (childEntry === undefined) {
        throw new Error("Expected child requirement");
      }
      return makeInitialPlanVersion(
        planRequest,
        context,
        coverage.map((entry) =>
          entry === childEntry ? { ...entry, resolution: prepared } : entry
        )
      );
    };
    const base = {
      childReviewOption: "roast" as const,
      stockConfirmedFor: "2026-09-28",
      twoPeople: true,
    };
    const unknownSource = authority({ ...base, stockSourceOption: "none" });
    expect(
      validatePlanVersion(
        planFor(unknownSource),
        planRequest,
        unknownSource,
        true
      )?.reason
    ).toBe("unreviewed_suitability");
    const adultCoverage = flexibleCoverage(planRequest, unknownSource);
    const adultEntry = adultCoverage.find(
      ({ requirement }) => requirement.personId === adultId
    );
    if (adultEntry === undefined) {
      throw new Error("Expected adult requirement");
    }
    const unknownAdultSource = makeInitialPlanVersion(
      planRequest,
      unknownSource,
      adultCoverage.map((entry) =>
        entry === adultEntry ? { ...entry, resolution: prepared } : entry
      )
    );
    expect(
      validatePlanVersion(unknownAdultSource, planRequest, unknownSource, true)
        ?.reason
    ).toBe("unreviewed_suitability");

    const unreviewed = authority({ ...base, stockSourceOption: "roast" });
    expect(
      validatePlanVersion(planFor(unreviewed), planRequest, unreviewed, true)
        ?.reason
    ).toBe("unreviewed_suitability");

    const incompatible = authority({
      ...base,
      childReview: "incompatible",
      stockSourceOption: "roast",
    });
    expect(
      validatePlanVersion(
        planFor(incompatible),
        planRequest,
        incompatible,
        true
      )?.reason
    ).toBe("incompatible_option");

    const compatible = authority({
      ...base,
      childReview: "compatible",
      stockSourceOption: "roast",
    });
    const approved = planFor(compatible);
    expect(
      validatePlanVersion(approved, planRequest, compatible, true)
    ).toBeNull();
    expect(approved.pins.preparedSources).toMatchObject([
      { optionRef: roast, outputId: "stock_portion_1" },
    ]);
  });

  it("checks the cook option for the person eating its prepared output", () => {
    const planRequest = request();
    const planFor = (context: PlanningAuthority) => {
      const coverage = flexibleCoverage(planRequest, context);
      const childEntry = coverage.find(
        ({ requirement }) =>
          requirement.personId === childId && requirement.date === "2026-09-29"
      );
      if (childEntry === undefined) {
        throw new Error("Expected child requirement");
      }
      const initial = makeInitialPlanVersion(planRequest, context, coverage);
      const withCook = Schema.decodeUnknownSync(MealPlanVersion)({
        ...initial,
        cookEvents: [
          {
            batchCount: 1,
            date: planRequest.startDate,
            eventId: "event_roast",
            option: roast,
            outputs: [
              {
                outputId: "output_roast",
                quantity: { amount: 1, unit: "portion" },
                source: "adult_confirmed",
              },
            ],
          },
        ],
        coverage: coverage.map((entry) =>
          entry === childEntry
            ? {
                ...entry,
                resolution: decodeResolution({
                  _tag: "Prepared",
                  outputId: "output_roast",
                  quantity: { amount: 1, unit: "portion" },
                  rationale: "Roast from Monday's cook.",
                }),
              }
            : entry
        ),
      });
      return repinPlanVersion(withCook, context);
    };
    const base = {
      childReviewOption: "roast" as const,
      recipeResolved: true,
      twoPeople: true,
    };
    const unreviewed = authority(base);
    expect(
      validatePlanVersion(planFor(unreviewed), planRequest, unreviewed, true)
        ?.reason
    ).toBe("unreviewed_suitability");
    const incompatible = authority({ ...base, childReview: "incompatible" });
    expect(
      validatePlanVersion(
        planFor(incompatible),
        planRequest,
        incompatible,
        true
      )?.reason
    ).toBe("incompatible_option");
    const compatible = authority({ ...base, childReview: "compatible" });
    expect(
      validatePlanVersion(planFor(compatible), planRequest, compatible, true)
    ).toBeNull();
  });
});

const memoryRepository = (): MealPlanRepository => {
  const plans = new Map<string, MealPlan>();
  const receipts = new Map<string, { fingerprint: string; plan: MealPlan }>();
  return {
    create: ({ draft }) =>
      Effect.sync(() => {
        plans.set(draft.planId, draft);
        return draft;
      }),
    find: (planId) =>
      Effect.sync(() => {
        const plan = plans.get(planId);
        return plan === undefined ? Option.none<MealPlan>() : Option.some(plan);
      }),
    findMutation: ({ planId, mutationId, mutationFingerprint }) =>
      Effect.gen(function* findReceipt() {
        const receipt = receipts.get(`${planId}:${mutationId}`);
        if (receipt && receipt.fingerprint !== mutationFingerprint) {
          return yield* Effect.fail({
            _tag: "MealPlanMutationConflict" as const,
            mutationId,
          });
        }
        return receipt === undefined
          ? Option.none<MealPlan>()
          : Option.some(receipt.plan);
      }),
    listRecent: () => Effect.sync(() => [...plans.values()]),
    save: ({ next, expectedRevision, mutationFingerprint, mutationId }) =>
      Effect.gen(function* savePlan() {
        const current = plans.get(next.planId);
        if (current === undefined) {
          return yield* Effect.fail({
            _tag: "MealPlanNotFound" as const,
            planId: next.planId,
          });
        }
        if (current.revision !== expectedRevision) {
          return yield* Effect.fail({
            _tag: "MealPlanVersionConflict" as const,
            actualRevision: current.revision,
            expectedRevision,
          });
        }
        plans.set(next.planId, next);
        receipts.set(`${next.planId}:${mutationId}`, {
          fingerprint: mutationFingerprint,
          plan: next,
        });
        return next;
      }),
  };
};

describe("meal plan lifecycle", () => {
  it("refreshes pins after unavailable prepared food becomes a gap", async () => {
    const planRequest = request();
    const original = authority({
      recipeResolved: true,
      stockConfirmedFor: "2026-09-28",
      stockSourceOption: "roast",
    });
    const coverage = flexibleCoverage(planRequest, original);
    const [first] = coverage;
    if (first === undefined) {
      throw new Error("Expected breakfast coverage");
    }
    coverage[0] = {
      ...first,
      resolution: decodeResolution({
        _tag: "Prepared",
        outputId: "stock_portion_1",
        quantity: { amount: 1, unit: "portion" },
        rationale: "Use confirmed stock.",
      }),
    };
    const service = makeMealPlanService(memoryRepository());
    const created = await Effect.runPromise(
      service.create(planRequest, original, coverage)
    );
    const current: PlanningAuthority = {
      ...original,
      content: Schema.decodeUnknownSync(PlanningContentSnapshot)({
        ...original.content,
        configVersion: 2,
        preparedPortions: [],
      }),
    };
    const refreshed = await Effect.runPromise(
      service.change(
        {
          actorId,
          at,
          change: { _tag: "RefreshInputs" },
          expectedRevision: 0,
          mutationId: decodeMutationId("refresh_missing_stock"),
          planId: created.planId,
          reason: "Stock is no longer available.",
        },
        current
      )
    );
    if (refreshed._tag !== "Draft") {
      throw new Error("Expected draft");
    }
    expect(refreshed.proposed.coverage[0]?.resolution).toMatchObject({
      _tag: "Gap",
      reason: "dependent_output_removed",
    });
    expect(refreshed.proposed.pins.preparedSources).toEqual([]);
    expect(refreshed.proposed.pins.content).toEqual([]);
    const repaired = await Effect.runPromise(
      service.change(
        {
          actorId,
          at,
          change: {
            _tag: "SetCoverage",
            requirement: first.requirement,
            resolution: decodeResolution({
              _tag: "Flexible",
              rationale: "Adult chose a flexible meal.",
            }),
          },
          expectedRevision: 1,
          mutationId: decodeMutationId("replace_missing_stock"),
          planId: created.planId,
          reason: "Resolve the missing prepared food.",
        },
        current
      )
    );
    expect(repaired.revision).toBe(2);
    const approved = await Effect.runPromise(
      service.approve(
        {
          actorId,
          at,
          expectedRevision: 2,
          mutationId: decodeMutationId("approve_refreshed_stock"),
          planId: created.planId,
          reason: "Approve repaired week.",
        },
        current
      )
    );
    expect(approved._tag).toBe("Approved");
  });

  it.each([
    {
      allocated: false,
      optionKind: "recipe",
      reason: "quantity_unit_mismatch",
    },
    { allocated: true, optionKind: "recipe", reason: "quantity_unit_mismatch" },
    { allocated: true, optionKind: "external", reason: "invalid_cook_output" },
    { allocated: false, optionKind: "external", reason: "invalid_cook_output" },
  ] as const)(
    "rejects $optionKind cook outputs with incompatible units when allocated=$allocated",
    async ({ allocated, optionKind, reason }) => {
      const planRequest = request();
      const base = authority({ recipeResolved: true });
      const external = {
        kind: "external",
        optionId: "option_takeaway",
        optionVersion: 1,
      };
      const context: PlanningAuthority =
        optionKind === "external"
          ? {
              ...base,
              content: Schema.decodeUnknownSync(PlanningContentSnapshot)({
                ...base.content,
                options: [
                  ...base.content.options,
                  {
                    ...external,
                    cover: null,
                    label: "Takeaway",
                    provider: null,
                  },
                ],
              }),
            }
          : base;
      const coverage = flexibleCoverage(planRequest, context);
      const [first] = coverage;
      if (first === undefined) {
        throw new Error("Expected breakfast coverage");
      }
      const option = optionKind === "external" ? external : roast;
      if (allocated) {
        coverage[0] = {
          ...first,
          resolution: decodeResolution({
            _tag: "MealOption",
            eventId: "event_bad_output",
            option,
            quantity:
              optionKind === "external" ? null : { amount: 1, unit: "portion" },
            rationale: "Use the planned meal.",
          }),
        };
      }
      const service = makeMealPlanService(memoryRepository());
      const created = await Effect.runPromise(
        service.create(planRequest, context, coverage)
      );
      const failure = await Effect.runPromise(
        service
          .change(
            {
              actorId,
              at,
              change: {
                _tag: "SetCookEvent",
                event: {
                  batchCount: 1,
                  date: planRequest.startDate,
                  eventId: "event_bad_output",
                  option: Schema.decodeUnknownSync(PlanningOptionRef)(option),
                  outputs: [
                    {
                      outputId: "output_bad",
                      quantity: { amount: 100, unit: "kg" },
                      source: "adult_confirmed",
                    },
                  ],
                },
              },
              expectedRevision: 0,
              mutationId: decodeMutationId(
                `bad_output_${optionKind}_${allocated}`
              ),
              planId: created.planId,
              reason: "Record a cook event.",
            },
            context
          )
          .pipe(Effect.flip)
      );
      expect(failure).toMatchObject({
        _tag: "MealPlanRuleViolation",
        reason,
      });
    }
  );

  it("keeps a valid prepared output available for a later meal", async () => {
    const planRequest = request();
    const context = authority({ recipeResolved: true });
    const coverage = flexibleCoverage(planRequest, context);
    const [, later] = coverage;
    if (later === undefined) {
      throw new Error("Expected a later meal");
    }
    coverage[1] = {
      ...later,
      resolution: decodeResolution({
        _tag: "Prepared",
        outputId: "output_roast",
        quantity: { amount: 1, unit: "portion" },
        rationale: "Use a portion from the cook event.",
      }),
    };
    const service = makeMealPlanService(memoryRepository());
    const created = await Effect.runPromise(
      service.create(
        planRequest,
        context,
        flexibleCoverage(planRequest, context)
      )
    );
    const changed = await Effect.runPromise(
      service.change(
        {
          actorId,
          at,
          change: {
            _tag: "ReplaceDraftPlan",
            cookEvents: [
              {
                batchCount: 1,
                date: planRequest.startDate,
                eventId: "event_roast",
                option: Schema.decodeUnknownSync(PlanningOptionRef)(roast),
                outputs: [
                  {
                    outputId: "output_roast",
                    quantity: { amount: 1, unit: "portion" },
                    source: "adult_confirmed",
                  },
                ],
              },
            ],
            coverage,
          },
          expectedRevision: 0,
          mutationId: decodeMutationId("valid_roast_output"),
          planId: created.planId,
          reason: "Plan a cooked meal for later.",
        },
        context
      )
    );
    expect(changed._tag).toBe("Draft");
    const approved = await Effect.runPromise(
      service.approve(
        {
          actorId,
          at,
          expectedRevision: 1,
          mutationId: decodeMutationId("approve_valid_roast_output"),
          planId: created.planId,
          reason: "Approve prepared meal.",
        },
        context
      )
    );
    expect(approved.active.coverage[1]?.resolution).toMatchObject({
      _tag: "Prepared",
      outputId: "output_roast",
    });
  });

  it("refuses approval of a stored prepared meal from an invalid cook output", async () => {
    const planRequest = request();
    const context = authority({ recipeResolved: true });
    const repository = memoryRepository();
    const service = makeMealPlanService(repository);
    const created = await Effect.runPromise(
      service.create(
        planRequest,
        context,
        flexibleCoverage(planRequest, context)
      )
    );
    if (created._tag !== "Draft") {
      throw new Error("Expected draft");
    }
    const [, preparedEntry] = created.proposed.coverage;
    if (preparedEntry === undefined) {
      throw new Error("Expected a later meal");
    }
    const unsafe = {
      ...created,
      proposed: repinPlanVersion(
        Schema.decodeUnknownSync(MealPlanVersion)({
          ...created.proposed,
          cookEvents: [
            {
              batchCount: 1,
              date: planRequest.startDate,
              eventId: "event_bad_source",
              option: roast,
              outputs: [
                {
                  outputId: "output_bad_source",
                  quantity: { amount: 100, unit: "kg" },
                  source: "adult_confirmed",
                },
              ],
            },
          ],
          coverage: created.proposed.coverage.map((entry) =>
            entry === preparedEntry
              ? {
                  ...entry,
                  resolution: decodeResolution({
                    _tag: "Prepared",
                    outputId: "output_bad_source",
                    quantity: { amount: 1, unit: "kg" },
                    rationale: "Use the cooked meal.",
                  }),
                }
              : entry
          ),
        }),
        context
      ),
      revision: 1,
    };
    await Effect.runPromise(
      repository.save({
        expectedRevision: 0,
        mutationFingerprint: "stored_invalid_draft",
        mutationId: decodeMutationId("stored_invalid_draft"),
        next: unsafe,
      })
    );
    const failure = await Effect.runPromise(
      service
        .approve(
          {
            actorId,
            at,
            expectedRevision: 1,
            mutationId: decodeMutationId("approve_invalid_source"),
            planId: created.planId,
            reason: "Review prepared meal.",
          },
          context
        )
        .pipe(Effect.flip)
    );
    expect(failure).toMatchObject({
      _tag: "MealPlanRuleViolation",
      reason: "quantity_unit_mismatch",
    });
  });

  it("accepts a complete agent proposal atomically and preserves its retry result", async () => {
    const context = authority();
    const planRequest = request();
    const service = makeMealPlanService(memoryRepository());
    const created = await Effect.runPromise(
      service.create(planRequest, context)
    );
    if (created._tag !== "Draft") {
      throw new Error("Expected draft");
    }
    expect(
      created.proposed.coverage.every(
        ({ resolution }) => resolution._tag === "Gap"
      )
    ).toBe(true);
    const complete = flexibleCoverage(planRequest, context);
    const [first] = complete;
    if (first === undefined) {
      throw new Error("Expected first occasion");
    }
    complete[0] = {
      ...first,
      resolution: decodeResolution({
        _tag: "MealOption",
        eventId: "event_cereal",
        option: cereal,
        quantity: { amount: 1, unit: "item" },
        rationale: "Reviewed breakfast.",
      }),
    };
    const command = {
      actorId,
      at,
      change: {
        _tag: "ReplaceDraftPlan" as const,
        cookEvents: [],
        coverage: complete,
      },
      expectedRevision: 0,
      mutationId: decodeMutationId("whole_week_1"),
      planId: created.planId,
      reason: "Review a full proposal.",
    };
    const changed = await Effect.runPromise(service.change(command, context));
    expect(changed._tag).toBe("Draft");
    expect(changed.revision).toBe(1);
    expect(await Effect.runPromise(service.change(command, context))).toEqual(
      changed
    );
    const approved = await Effect.runPromise(
      service.approve(
        {
          actorId,
          at,
          expectedRevision: 1,
          mutationId: decodeMutationId("approve_week_1"),
          planId: created.planId,
          reason: "Approve this week.",
        },
        context
      )
    );
    expect(
      approved.active.coverage.every(
        ({ resolution }) => resolution._tag !== "Gap"
      )
    ).toBe(true);
  });

  it("keeps an approved version immutable while a later revision is proposed", async () => {
    const context = authority();
    const planRequest = request();
    const service = makeMealPlanService(memoryRepository());
    const created = await Effect.runPromise(
      service.create(
        planRequest,
        context,
        flexibleCoverage(planRequest, context)
      )
    );
    const command = (id: string, revision: number) => ({
      actorId,
      at,
      expectedRevision: revision,
      mutationId: decodeMutationId(id),
      planId: created.planId as MealPlanId,
      reason: "Adult review.",
    });
    const approved = await Effect.runPromise(
      service.approve(command("approve_1", 0), context)
    );
    const replay = await Effect.runPromise(
      service.approve(command("approve_1", 0), context)
    );
    expect(replay).toEqual(approved);
    const proposed = await Effect.runPromise(
      service.proposeRevision(command("revision_1", 1), context)
    );
    expect(proposed._tag).toBe("ProposedRevision");
    if (proposed._tag !== "ProposedRevision") {
      return;
    }
    expect(proposed.active).toEqual(approved.active);
    expect(proposed.proposed.number).toBe(approved.active.number + 1);
    expect(proposed.audit.at(-1)?.action).toBe("propose_revision");
  });
});
