import { Schema } from "effect";

import { HouseholdPersonId } from "./people.js";
import { ProfileVersion } from "./profiles.js";

const Label = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(160))
);
const Id = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isPattern(/^[A-Za-z\d][A-Za-z\d_-]{7,127}$/u)
  )
);
const Version = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)));
const NonnegativeVersion = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);
const PositiveQuantity = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThan(0))
);
const DateString = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u),
    Schema.makeFilter((date) => {
      const parsed = new Date(`${date}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date
        ? undefined
        : "Expected a real calendar date";
    })
  )
);

export const PlanningContentId = Id.pipe(Schema.brand("PlanningContentId"));
export type PlanningContentId = typeof PlanningContentId.Type;
export const PlanningContentMutationId = Id.pipe(
  Schema.brand("PlanningContentMutationId")
);
export type PlanningContentMutationId = typeof PlanningContentMutationId.Type;
export const PlanningContentVersion = NonnegativeVersion.pipe(
  Schema.brand("PlanningContentVersion")
);
export type PlanningContentVersion = typeof PlanningContentVersion.Type;
export const PlanningOptionVersion = Version.pipe(
  Schema.brand("PlanningOptionVersion")
);
export type PlanningOptionVersion = typeof PlanningOptionVersion.Type;
export const PlanningDate = DateString.pipe(Schema.brand("PlanningDate"));
export type PlanningDate = typeof PlanningDate.Type;

export const MealOccasionId = Id.pipe(Schema.brand("MealOccasionId"));
export type MealOccasionId = typeof MealOccasionId.Type;
export const Weekday = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6))
);
export type Weekday = typeof Weekday.Type;
export const Location = Schema.Literals([
  "home",
  "office",
  "school",
  "travel",
  "other",
]);
export type Location = typeof Location.Type;
export const SubstitutionPolicy = Schema.Literals([
  "exact_only",
  "ask",
  "similar_acceptable",
]);
export type SubstitutionPolicy = typeof SubstitutionPolicy.Type;
export const QuantityUnit = Schema.Literals([
  "portion",
  "item",
  "pack",
  "g",
  "kg",
  "ml",
  "l",
  "tsp",
  "tbsp",
]);
export type QuantityUnit = typeof QuantityUnit.Type;
export const KnownQuantity = Schema.Struct({
  _tag: Schema.Literal("Known"),
  amount: PositiveQuantity,
  sourceText: Schema.NullOr(Label),
  unit: QuantityUnit,
});
export type KnownQuantity = typeof KnownQuantity.Type;
export const UnresolvedQuantity = Schema.Struct({
  _tag: Schema.Literal("Unresolved"),
  sourceText: Label,
});
export type UnresolvedQuantity = typeof UnresolvedQuantity.Type;
export const Quantity = Schema.Union([KnownQuantity, UnresolvedQuantity]);
export type Quantity = typeof Quantity.Type;

export const PlanningOptionRef = Schema.Struct({
  kind: Schema.Literals(["recipe", "assembled", "packaged", "external"]),
  optionId: PlanningContentId,
  optionVersion: PlanningOptionVersion,
});
export type PlanningOptionRef = typeof PlanningOptionRef.Type;

export const FoodComponent = Schema.Struct({
  name: Label,
  quantity: Quantity,
  substitutionPolicy: SubstitutionPolicy,
});
export type FoodComponent = typeof FoodComponent.Type;
export const PreparationTime = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Known"),
    minutes: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  Schema.Struct({ _tag: Schema.Literal("Unknown") }),
]);
export type PreparationTime = typeof PreparationTime.Type;
export const PreparationProfile = Schema.Struct({
  attention: Schema.Literals(["low", "moderate", "high", "unknown"]),
  cleanup: Schema.Literals(["low", "moderate", "high", "unknown"]),
  elapsedTime: PreparationTime,
  handsOnTime: PreparationTime,
  requiredEquipment: Schema.Array(Label),
  startRequirement: Schema.Literals([
    "none",
    "during_window",
    "advance_start",
    "unknown",
  ]),
  substantialCookEvent: Schema.Literals(["yes", "no", "unknown"]),
});
export type PreparationProfile = typeof PreparationProfile.Type;
export const MealOptionCover = Schema.Literals([
  "pesto-pasta",
  "tacos",
  "fish",
  "rice-bowls",
  "pizza",
]);
export type MealOptionCover = typeof MealOptionCover.Type;
export const MealOption = Schema.Union([
  Schema.Struct({
    ...PlanningOptionRef.fields,
    cover: Schema.NullOr(MealOptionCover),
    kind: Schema.Literal("recipe"),
    label: Label,
    preparation: PreparationProfile,
    recipeId: Schema.String.pipe(Schema.check(Schema.isUUID())),
    recipeImportId: Schema.String.pipe(Schema.check(Schema.isUUID())),
    recipeVersion: Version,
    shoppingComponents: Schema.Array(FoodComponent),
    shoppingStatus: Schema.Literals(["reviewed", "unresolved"]),
    yield: Schema.Union([KnownQuantity, UnresolvedQuantity]),
  }),
  Schema.Struct({
    ...PlanningOptionRef.fields,
    components: Schema.NonEmptyArray(FoodComponent),
    cover: Schema.NullOr(MealOptionCover),
    kind: Schema.Literal("assembled"),
    label: Label,
    preparation: PreparationProfile,
    yield: Quantity,
  }),
  Schema.Struct({
    ...PlanningOptionRef.fields,
    cover: Schema.NullOr(MealOptionCover),
    kind: Schema.Literal("packaged"),
    label: Label,
    preparation: PreparationProfile,
    productIdentity: Schema.NullOr(Label),
    productName: Label,
    quantity: Quantity,
    substitutionPolicy: SubstitutionPolicy,
  }),
  Schema.Struct({
    ...PlanningOptionRef.fields,
    cover: Schema.NullOr(MealOptionCover),
    kind: Schema.Literal("external"),
    label: Label,
    provider: Schema.NullOr(Label),
  }),
]);
export type MealOption = typeof MealOption.Type;

export const ManagedOccasion = Schema.Struct({
  label: Label,
  occasionId: MealOccasionId,
  personId: HouseholdPersonId,
  state: Schema.Literals(["managed", "disabled"]),
  weekdays: Schema.NonEmptyArray(Weekday),
});
export type ManagedOccasion = typeof ManagedOccasion.Type;
export const Availability = Schema.Struct({
  handsOffStart: Schema.Literals(["available", "unavailable", "unknown"]),
  location: Location,
  occasionId: MealOccasionId,
  personId: HouseholdPersonId,
  preparationWindowMinutes: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  weekdays: Schema.NonEmptyArray(Weekday),
});
export type Availability = typeof Availability.Type;
export const CookingCapacity = Schema.Struct({
  availableEquipment: Schema.Array(Label),
  maximumSubstantialCookEventsPerWeek: Schema.Int.pipe(
    Schema.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(21)
    )
  ),
});
export type CookingCapacity = typeof CookingCapacity.Type;

export const RoutineChoice = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Options"),
    optionRefs: Schema.NonEmptyArray(PlanningOptionRef),
    selection: Schema.Literals(["pin", "prefer", "rotate"]),
  }),
  Schema.Struct({ _tag: Schema.Literal("Leftover") }),
  Schema.Struct({
    _tag: Schema.Literal("External"),
    optionRef: PlanningOptionRef,
  }),
  Schema.Struct({ _tag: Schema.Literal("Skip") }),
  Schema.Struct({ _tag: Schema.Literal("Flexible") }),
]);
export type RoutineChoice = typeof RoutineChoice.Type;
export const Routine = Schema.Struct({
  choice: RoutineChoice,
  id: PlanningContentId,
  occasionId: MealOccasionId,
  scope: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("Household") }),
    Schema.Struct({
      _tag: Schema.Literal("Person"),
      personId: HouseholdPersonId,
    }),
  ]),
  state: Schema.Literals(["active", "paused"]),
  version: Version,
  weekdays: Schema.NonEmptyArray(Weekday),
});
export type Routine = typeof Routine.Type;
export const OneOffRoutine = Schema.Struct({
  choice: RoutineChoice,
  date: PlanningDate,
  id: PlanningContentId,
  occasionId: MealOccasionId,
  personId: HouseholdPersonId,
  version: Version,
});
export type OneOffRoutine = typeof OneOffRoutine.Type;
export const Fallback = Schema.Struct({
  id: PlanningContentId,
  locations: Schema.Array(Location),
  occasionIds: Schema.Array(MealOccasionId),
  optionRef: PlanningOptionRef,
  personId: HouseholdPersonId,
  priority: Version,
  state: Schema.Literals(["active", "paused", "unavailable"]),
  substitutionPolicy: SubstitutionPolicy,
  version: Version,
});
export type Fallback = typeof Fallback.Type;

/** A human review is pinned to both the confirmed profile and exact content version. */
export const SuitabilityReview = Schema.Struct({
  confirmedByActorId: Id,
  id: PlanningContentId,
  optionRef: PlanningOptionRef,
  personId: HouseholdPersonId,
  profileVersion: ProfileVersion,
  reason: Label,
  status: Schema.Literals(["compatible", "incompatible", "unknown"]),
  version: Version,
});
export type SuitabilityReview = typeof SuitabilityReview.Type;

/** Adult review input. The server supplies the actor digest. */
export const SuitabilityReviewWrite = Schema.Struct({
  confirmation: Schema.Literal("I reviewed this food for this person"),
  id: PlanningContentId,
  optionRef: PlanningOptionRef,
  personId: HouseholdPersonId,
  profileVersion: ProfileVersion,
  reason: Label,
  status: Schema.Literals(["compatible", "incompatible", "unknown"]),
  version: Version,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type SuitabilityReviewWrite = typeof SuitabilityReviewWrite.Type;

export const PreparedPortion = Schema.Struct({
  confirmedForWeekStart: Schema.NullOr(PlanningDate),
  id: PlanningContentId,
  label: Label,
  lastCorrectionReason: Label,
  quantity: KnownQuantity,
  remainingAmount: Schema.Number.pipe(
    Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
  ),
  reservations: Schema.Array(
    Schema.Struct({
      amount: PositiveQuantity,
      coverageKey: Schema.String.pipe(
        Schema.check(
          Schema.isTrimmed(),
          Schema.isNonEmpty(),
          Schema.isMaxLength(400)
        )
      ),
      date: PlanningDate,
      planId: Label,
      weekStart: PlanningDate,
    })
  ),
  sourceCookEventId: Schema.NullOr(PlanningContentId),
  sourceOptionRef: Schema.NullOr(PlanningOptionRef),
  state: Schema.Literals([
    "available",
    "reserved",
    "consumed",
    "discarded",
    "uncertain",
  ]),
  storage: Schema.Literals(["fridge", "freezer", "other"]),
  version: Version,
});
export type PreparedPortion = typeof PreparedPortion.Type;

/** Adult stock record or correction. Plan reservations are never browser input. */
export const PreparedPortionWrite = Schema.Struct({
  confirmedForWeekStart: Schema.NullOr(PlanningDate),
  id: PlanningContentId,
  label: Label,
  quantity: KnownQuantity,
  reason: Label,
  remainingAmount: Schema.Number.pipe(
    Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
  ),
  sourceCookEventId: Schema.NullOr(PlanningContentId),
  sourceOptionRef: Schema.NullOr(PlanningOptionRef),
  state: Schema.Literals(["available", "consumed", "discarded", "uncertain"]),
  storage: Schema.Literals(["fridge", "freezer", "other"]),
  version: Version,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type PreparedPortionWrite = typeof PreparedPortionWrite.Type;

/** Adult confirmation after earlier allocations have passed. */
export const ConfirmPreparedCarryOver = Schema.Struct({
  confirmation: Schema.Literal("I confirm this prepared food still exists"),
  confirmedForWeekStart: PlanningDate,
  expectedPortionVersion: Version,
  id: PlanningContentId,
  reason: Label,
  remainingAmount: Schema.Number.pipe(
    Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
  ),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ConfirmPreparedCarryOver = typeof ConfirmPreparedCarryOver.Type;

/** Server-owned authority snapshot. The browser cannot supply this to plan creation. */
export const PlanningContentSnapshot = Schema.Struct({
  availability: Schema.Array(Availability),
  configVersion: PlanningContentVersion,
  cookingCapacity: CookingCapacity,
  fallbacks: Schema.Array(Fallback),
  managedOccasions: Schema.Array(ManagedOccasion),
  oneOffRoutines: Schema.Array(OneOffRoutine),
  options: Schema.Array(MealOption),
  preparedPortions: Schema.Array(PreparedPortion),
  routines: Schema.Array(Routine),
  suitabilityReviews: Schema.Array(SuitabilityReview),
});
export type PlanningContentSnapshot = typeof PlanningContentSnapshot.Type;

export const PlanningContentCommand = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("SetManagedOccasions"),
    entries: Schema.Array(ManagedOccasion),
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetPersonManagedOccasions"),
    entries: Schema.Array(ManagedOccasion),
    personId: HouseholdPersonId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetAvailability"),
    entries: Schema.Array(Availability),
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetPersonAvailability"),
    entries: Schema.Array(Availability),
    personId: HouseholdPersonId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetCookingCapacity"),
    value: CookingCapacity,
  }),
  Schema.Struct({ _tag: Schema.Literal("PutRoutine"), value: Routine }),
  Schema.Struct({
    _tag: Schema.Literal("PutOneOffRoutine"),
    value: OneOffRoutine,
  }),
  Schema.Struct({ _tag: Schema.Literal("PutFallback"), value: Fallback }),
  Schema.Struct({ _tag: Schema.Literal("PutOption"), value: MealOption }),
  Schema.Struct({
    _tag: Schema.Literal("PutSuitabilityReview"),
    value: SuitabilityReviewWrite,
  }),
  Schema.Struct({
    _tag: Schema.Literal("PutPreparedPortion"),
    value: PreparedPortionWrite,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ConfirmPreparedCarryOver"),
    value: ConfirmPreparedCarryOver,
  }),
]);
export type PlanningContentCommand = typeof PlanningContentCommand.Type;
export const MutatePlanningContentPayload = Schema.Struct({
  command: PlanningContentCommand,
  expectedVersion: PlanningContentVersion,
  mutationId: PlanningContentMutationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type MutatePlanningContentPayload =
  typeof MutatePlanningContentPayload.Type;

export const PlanningContentRejected = Schema.TaggedStruct(
  "PlanningContentRejected",
  {
    reason: Schema.Literals([
      "stale_version",
      "mutation_collision",
      "missing_person",
      "stale_profile",
      "stale_option",
      "invalid_transition",
      "quantity_exceeded",
      "unavailable",
    ]),
  }
);
export type PlanningContentRejected = typeof PlanningContentRejected.Type;

/** Browser list projection of canonical saved recipes; full detail stays in recipe import. */
export const SavedRecipeSummary = Schema.Struct({
  importId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  name: Schema.NullOr(Label),
  recipeId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  version: Version,
});
export type SavedRecipeSummary = typeof SavedRecipeSummary.Type;
export const SavedRecipePage = Schema.Struct({
  items: Schema.Array(SavedRecipeSummary),
  nextCursor: Schema.NullOr(SavedRecipeSummary.fields.recipeId),
});
export type SavedRecipePage = typeof SavedRecipePage.Type;
export const SavedRecipePageQuery = Schema.Struct({
  cursor: Schema.optional(SavedRecipeSummary.fields.recipeId),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type SavedRecipePageQuery = typeof SavedRecipePageQuery.Type;
