import { Schema } from "effect";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

export const PlanningDifficulty = Schema.Literals(["easy", "medium", "hard"]);
export type PlanningDifficulty = typeof PlanningDifficulty.Type;

export const PlanningLeftovers = Schema.Literals([
  "none",
  "one_meal",
  "two_plus_meals",
]);
export type PlanningLeftovers = typeof PlanningLeftovers.Type;

export const PlanningMealType = Schema.Literals([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "dessert",
]);
export type PlanningMealType = typeof PlanningMealType.Type;

export const PlanningTotalTimeBand = Schema.Literals([
  "under_30_minutes",
  "30_to_60_minutes",
  "over_60_minutes",
  "unknown",
]);
export type PlanningTotalTimeBand = typeof PlanningTotalTimeBand.Type;

export const PlanningTags = Schema.Struct({
  cuisines: Schema.NonEmptyArray(TrimmedNonEmptyString).pipe(
    Schema.check(Schema.isMaxLength(8))
  ),
  difficulty: PlanningDifficulty,
  leftovers: PlanningLeftovers,
  mealTypes: Schema.NonEmptyArray(PlanningMealType).pipe(
    Schema.check(Schema.isMaxLength(5))
  ),
  totalTimeBand: PlanningTotalTimeBand,
});
export type PlanningTags = typeof PlanningTags.Type;
