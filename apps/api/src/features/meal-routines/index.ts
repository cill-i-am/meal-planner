import type {
  HouseholdPersonId,
  MealOccasionId,
  PlanningContentSnapshot,
  PlanningDate,
  PlanningOptionRef,
  ProfileVersion,
  RoutineChoice,
} from "@meal-planner/household-api";
import { PlanningDate as PlanningDateSchema } from "@meal-planner/household-api";

import { contentSuitabilityIssue } from "../meal-content/index.js";

const casesHandled = (value: never): never => {
  throw new Error(`Unexpected routine choice: ${String(value)}`);
};

export interface CoverageRequirement {
  readonly personId: HouseholdPersonId;
  readonly date: PlanningDate;
  readonly occasionId: MealOccasionId;
  /** JavaScript UTC weekday, Sunday = 0. */
  readonly weekday: number;
}

export type RoutineResolution =
  | { readonly _tag: "NoRoutine" }
  | {
      readonly _tag: "Applied";
      readonly choice: RoutineChoice;
      readonly source: {
        readonly id: string;
        readonly scope: "one_off" | "person" | "household";
        readonly version: number;
      };
    }
  | {
      readonly _tag: "Conflict";
      readonly ruleIds: readonly string[];
      readonly scope: "one_off" | "person" | "household";
    }
  | {
      readonly _tag: "BlockedSuitability";
      readonly optionRefs: readonly PlanningOptionRef[];
      readonly ruleId: string;
    };

const dateOf = (value: Date) => {
  const checkedResult: PlanningDate = PlanningDateSchema.make(
    value.toISOString().slice(0, 10)
  );
  return checkedResult;
};

/** Expands only adult-confirmed managed occasions. No calendar coverage is inferred. */
export const expandManagedOccasions = (
  snapshot: PlanningContentSnapshot,
  activePersonIds: ReadonlySet<HouseholdPersonId>,
  startDate: PlanningDate,
  weeks: number
) => {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const requirements: CoverageRequirement[] = [];
  for (let offset = 0; offset < weeks * 7; offset += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + offset);
    const weekday = day.getUTCDay();
    const date = dateOf(day);
    for (const occasion of snapshot.managedOccasions) {
      if (
        occasion.state === "managed" &&
        activePersonIds.has(occasion.personId) &&
        occasion.weekdays.includes(weekday)
      ) {
        requirements.push({
          date,
          occasionId: occasion.occasionId,
          personId: occasion.personId,
          weekday,
        });
      }
    }
  }
  {
    const checkedResult: readonly CoverageRequirement[] = requirements;
    return checkedResult;
  }
};

const refsFor = (choice: RoutineChoice) => {
  switch (choice._tag) {
    case "Options": {
      const checkedResult: readonly PlanningOptionRef[] = choice.optionRefs;
      return checkedResult;
    }
    case "External": {
      const checkedResult: readonly PlanningOptionRef[] = [choice.optionRef];
      return checkedResult;
    }
    case "Leftover":
    case "Skip":
    case "Flexible": {
      const checkedResult: readonly PlanningOptionRef[] = [];
      return checkedResult;
    }
    default: {
      const checkedResult: readonly PlanningOptionRef[] = casesHandled(choice);
      return checkedResult;
    }
  }
};

/** Applies one-off > person > household precedence; equal-priority ambiguity is visible. */
export const resolveRoutineForCoverage = (
  snapshot: PlanningContentSnapshot,
  input: {
    readonly requirement: CoverageRequirement;
    readonly profileVersion: ProfileVersion;
    readonly safetyState: "confirmed_none" | "has_constraints" | "unknown";
  }
) => {
  const { requirement } = input;
  const oneOffs = snapshot.oneOffRoutines.filter(
    (rule) =>
      rule.date === requirement.date &&
      rule.personId === requirement.personId &&
      rule.occasionId === requirement.occasionId
  );
  const personRules = snapshot.routines.filter(
    (rule) =>
      rule.state === "active" &&
      rule.scope._tag === "Person" &&
      rule.scope.personId === requirement.personId &&
      rule.occasionId === requirement.occasionId &&
      rule.weekdays.includes(requirement.weekday)
  );
  const householdRules = snapshot.routines.filter(
    (rule) =>
      rule.state === "active" &&
      rule.scope._tag === "Household" &&
      rule.occasionId === requirement.occasionId &&
      rule.weekdays.includes(requirement.weekday)
  );
  const ranked = [
    { rules: oneOffs, scope: "one_off" as const },
    { rules: personRules, scope: "person" as const },
    { rules: householdRules, scope: "household" as const },
  ];
  const selected = ranked.find(({ rules }) => rules.length > 0);
  if (!selected) {
    const checkedResult: RoutineResolution = { _tag: "NoRoutine" };
    return checkedResult;
  }
  if (selected.rules.length > 1) {
    const checkedResult: RoutineResolution = {
      _tag: "Conflict",
      ruleIds: selected.rules.map((rule) => rule.id),
      scope: selected.scope,
    };
    return checkedResult;
  }
  const [rule] = selected.rules;
  if (!rule) {
    const checkedResult: RoutineResolution = { _tag: "NoRoutine" };
    return checkedResult;
  }
  const blocked = refsFor(rule.choice).filter(
    (reference) =>
      contentSuitabilityIssue(snapshot, {
        optionRef: reference,
        personId: requirement.personId,
        profileVersion: input.profileVersion,
        safetyState: input.safetyState,
      }) !== null
  );
  if (blocked.length > 0) {
    const checkedResult: RoutineResolution = {
      _tag: "BlockedSuitability",
      optionRefs: blocked,
      ruleId: rule.id,
    };
    return checkedResult;
  }
  {
    const checkedResult: RoutineResolution = {
      _tag: "Applied",
      choice: rule.choice,
      source: { id: rule.id, scope: selected.scope, version: rule.version },
    };
    return checkedResult;
  }
};

export type FallbackResolution =
  | { readonly _tag: "None" }
  | {
      readonly _tag: "Selected";
      readonly fallbackId: string;
      readonly optionRef: PlanningOptionRef;
      readonly version: number;
    }
  | { readonly _tag: "Conflict"; readonly fallbackIds: readonly string[] };

export const resolveFallbackForCoverage = (
  snapshot: PlanningContentSnapshot,
  input: {
    readonly personId: HouseholdPersonId;
    readonly occasionId: MealOccasionId;
    readonly location: "home" | "office" | "school" | "travel" | "other";
    readonly profileVersion: ProfileVersion;
    readonly safetyState: "confirmed_none" | "has_constraints" | "unknown";
  }
) => {
  const candidates = snapshot.fallbacks
    .filter(
      (fallback) =>
        fallback.personId === input.personId &&
        fallback.state === "active" &&
        (fallback.occasionIds.length === 0 ||
          fallback.occasionIds.includes(input.occasionId)) &&
        (fallback.locations.length === 0 ||
          fallback.locations.includes(input.location)) &&
        contentSuitabilityIssue(snapshot, {
          optionRef: fallback.optionRef,
          personId: input.personId,
          profileVersion: input.profileVersion,
          safetyState: input.safetyState,
        }) === null
    )
    .toSorted((left, right) => left.priority - right.priority);
  const [first] = candidates;
  if (!first) {
    const checkedResult: FallbackResolution = { _tag: "None" };
    return checkedResult;
  }
  const tied = candidates.filter(
    (candidate) => candidate.priority === first.priority
  );
  if (tied.length > 1) {
    const checkedResult: FallbackResolution = {
      _tag: "Conflict",
      fallbackIds: tied.map((item) => item.id),
    };
    return checkedResult;
  }
  {
    const checkedResult: FallbackResolution = {
      _tag: "Selected",
      fallbackId: first.id,
      optionRef: first.optionRef,
      version: first.version,
    };
    return checkedResult;
  }
};
