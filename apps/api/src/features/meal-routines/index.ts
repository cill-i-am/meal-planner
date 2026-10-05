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

const dateOf = (value: Date): PlanningDate =>
  PlanningDateSchema.make(value.toISOString().slice(0, 10));

/** Expands only adult-confirmed managed occasions. No calendar coverage is inferred. */
export const expandManagedOccasions = (
  snapshot: PlanningContentSnapshot,
  activePersonIds: ReadonlySet<HouseholdPersonId>,
  startDate: PlanningDate,
  weeks: number
): readonly CoverageRequirement[] => {
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
  return requirements;
};

const refsFor = (choice: RoutineChoice): readonly PlanningOptionRef[] => {
  switch (choice._tag) {
    case "Options": {
      return choice.optionRefs;
    }
    case "External": {
      return [choice.optionRef];
    }
    case "Leftover":
    case "Skip":
    case "Flexible": {
      return [];
    }
    default: {
      return casesHandled(choice);
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
): RoutineResolution => {
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
    return { _tag: "NoRoutine" };
  }
  if (selected.rules.length > 1) {
    return {
      _tag: "Conflict",
      ruleIds: selected.rules.map((rule) => rule.id),
      scope: selected.scope,
    };
  }
  const [rule] = selected.rules;
  if (!rule) {
    return { _tag: "NoRoutine" };
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
    return { _tag: "BlockedSuitability", optionRefs: blocked, ruleId: rule.id };
  }
  return {
    _tag: "Applied",
    choice: rule.choice,
    source: { id: rule.id, scope: selected.scope, version: rule.version },
  };
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
): FallbackResolution => {
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
    return { _tag: "None" };
  }
  const tied = candidates.filter(
    (candidate) => candidate.priority === first.priority
  );
  if (tied.length > 1) {
    return { _tag: "Conflict", fallbackIds: tied.map((item) => item.id) };
  }
  return {
    _tag: "Selected",
    fallbackId: first.id,
    optionRef: first.optionRef,
    version: first.version,
  };
};
