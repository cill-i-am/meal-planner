import { MealOption, MealPlanDate } from "@meal-planner/household-api";
import type {
  MealPlanChange,
  MealPlanCoverage,
  MealPlanPersonPin,
  MealPlanRequest,
  MealPlanRequirementKey,
  MealPlanResolution,
  MealPlanRuleViolation,
  MealPlanVersion,
  MealPlanOptionRef,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import {
  contentSuitabilityIssue,
  isShoppingResolved,
  optionPreparationIssue,
} from "../meal-content/index.js";
import {
  expandManagedOccasions,
  resolveFallbackForCoverage,
  resolveRoutineForCoverage,
} from "../meal-routines/index.js";

export interface PlanningAuthority {
  readonly people: readonly MealPlanPersonPin[];
  readonly content: PlanningContentSnapshot;
}

const violation = (
  reason: MealPlanRuleViolation["reason"]
): MealPlanRuleViolation => ({ _tag: "MealPlanRuleViolation", reason });
const casesHandled = (value: never): never => {
  throw new Error(`Unexpected meal plan variant: ${String(value)}`);
};
const gap = (
  reason: Extract<MealPlanResolution, { _tag: "Gap" }>["reason"],
  rationale: string
): MealPlanResolution => ({ _tag: "Gap", rationale, reason });

export const requirementIdentity = (
  requirement: MealPlanRequirementKey
): string =>
  `${requirement.personId}\u0000${requirement.date}\u0000${requirement.occasion}`;

const optionIdentity = (option: {
  readonly optionId: string;
  readonly optionVersion: number;
  readonly kind: string;
}): string =>
  `${option.optionId}\u0000${option.optionVersion}\u0000${option.kind}`;

const dateAt = (start: string, offset: number): string => {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

/** Expand the saved per-person occasion configuration into dated requirements. */
export const requiredCoverage = (
  request: MealPlanRequest,
  authority: PlanningAuthority
): readonly MealPlanRequirementKey[] => {
  const activePeople = new Set(
    authority.people.map(({ personId }) => personId)
  );
  const requirements = new Map<string, MealPlanRequirementKey>();
  for (const entry of expandManagedOccasions(
    authority.content,
    activePeople,
    request.startDate,
    request.weeks
  )) {
    const requirement = {
      date: entry.date,
      occasion: entry.occasionId,
      personId: entry.personId,
    };
    requirements.set(requirementIdentity(requirement), requirement);
  }
  return [...requirements.values()].toSorted((left, right) =>
    requirementIdentity(left).localeCompare(requirementIdentity(right))
  );
};

const hasExactOption = (
  content: PlanningContentSnapshot,
  option: {
    readonly optionId: string;
    readonly optionVersion: number;
    readonly kind: string;
  }
): boolean =>
  content.options.some(
    (candidate) => optionIdentity(candidate) === optionIdentity(option)
  );

const findExactOption = (
  content: PlanningContentSnapshot,
  option: MealPlanOptionRef
) =>
  content.options.find(
    (candidate) => optionIdentity(candidate) === optionIdentity(option)
  );

const preparationIssueForCoverage = (
  authority: PlanningAuthority,
  option: NonNullable<ReturnType<typeof findExactOption>>,
  requirement: MealPlanRequirementKey
): MealPlanRuleViolation["reason"] | null => {
  const weekday = new Date(`${requirement.date}T00:00:00.000Z`).getUTCDay();
  const matches = authority.content.availability.filter(
    (entry) =>
      entry.personId === requirement.personId &&
      entry.occasionId === requirement.occasion &&
      entry.weekdays.includes(weekday)
  );
  if (matches.length !== 1 && option.kind !== "external") {
    return "availability_unknown";
  }
  return optionPreparationIssue(
    option,
    matches[0],
    authority.content.cookingCapacity
  );
};

const preparationIssueForCook = (
  authority: PlanningAuthority,
  option: NonNullable<ReturnType<typeof findExactOption>>,
  date: string
): MealPlanRuleViolation["reason"] | null => {
  if (option.kind === "external") {
    return null;
  }
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const candidates = authority.content.availability.filter(
    (entry) =>
      entry.weekdays.includes(weekday) &&
      authority.people.some((person) => person.personId === entry.personId)
  );
  if (candidates.length === 0) {
    return "availability_unknown";
  }
  const issues = candidates.map((entry) =>
    optionPreparationIssue(option, entry, authority.content.cookingCapacity)
  );
  return issues.includes(null) ? null : (issues[0] ?? "availability_unknown");
};

const personFor = (
  people: readonly MealPlanPersonPin[],
  personId: string
): MealPlanPersonPin | undefined =>
  people.find((person) => person.personId === personId);

const validateOptionForPerson = (
  authority: PlanningAuthority,
  person: MealPlanPersonPin,
  option: MealPlanOptionRef,
  approval: boolean
): MealPlanRuleViolation | null => {
  if (!hasExactOption(authority.content, option)) {
    return violation("content_version_changed");
  }
  const issue = contentSuitabilityIssue(authority.content, {
    optionRef: option,
    personId: person.personId,
    profileVersion: person.profileVersion,
    safetyState: person.safetyState,
  });
  if (issue === "incompatible") {
    return violation("incompatible_option");
  }
  if (approval && issue !== null) {
    return violation("unreviewed_suitability");
  }
  return null;
};

type PreparedSource =
  | {
      readonly amount: number;
      readonly unit: string;
      readonly kind: "stock";
      readonly confirmedWeek: string | null;
      readonly optionRef: MealPlanOptionRef | null;
    }
  | {
      readonly amount: number;
      readonly unit: string;
      readonly kind: "cook";
      readonly cookDate: string;
      readonly optionRef: MealPlanOptionRef;
    };

export const consumptionWeekStart = (
  request: MealPlanRequest,
  date: string
): MealPlanRequirementKey["date"] => {
  const day = Math.floor(
    (Date.parse(`${date}T00:00:00.000Z`) -
      Date.parse(`${request.startDate}T00:00:00.000Z`)) /
      86_400_000
  );
  return MealPlanDate.make(dateAt(request.startDate, Math.floor(day / 7) * 7));
};

const cookingCapacityIssue = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority
): MealPlanRuleViolation["reason"] | null => {
  const eventsByWeek = new Map<string, Set<string>>();
  const count = (
    eventId: string,
    date: string,
    optionRef: MealPlanOptionRef
  ) => {
    const option = findExactOption(authority.content, optionRef);
    if (
      option === undefined ||
      option.kind === "external" ||
      option.preparation.substantialCookEvent !== "yes"
    ) {
      return;
    }
    const week = consumptionWeekStart(request, date);
    const events = eventsByWeek.get(week) ?? new Set<string>();
    events.add(eventId);
    eventsByWeek.set(week, events);
  };
  for (const { requirement, resolution } of version.coverage) {
    if (resolution._tag === "MealOption") {
      count(resolution.eventId, requirement.date, resolution.option);
    }
  }
  for (const cook of version.cookEvents) {
    count(cook.eventId, cook.date, cook.option);
  }
  return [...eventsByWeek.values()].some(
    (events) =>
      events.size >
      authority.content.cookingCapacity.maximumSubstantialCookEventsPerWeek
  )
    ? "cooking_capacity_exceeded"
    : null;
};

const sourceQuantities = (
  version: MealPlanVersion,
  authority: PlanningAuthority,
  request: MealPlanRequest
): Map<string, PreparedSource> => {
  const sources = new Map<string, PreparedSource>();
  for (const portion of authority.content.preparedPortions) {
    if (portion.state !== "available" && portion.state !== "reserved") {
      continue;
    }
    const reservedElsewhere = portion.reservations
      .filter(({ planId }) => planId !== request.requestKey)
      .reduce((total, reservation) => total + reservation.amount, 0);
    sources.set(portion.id, {
      amount: Math.max(0, portion.remainingAmount - reservedElsewhere),
      confirmedWeek: portion.confirmedForWeekStart,
      kind: "stock",
      optionRef: portion.sourceOptionRef,
      unit: portion.quantity.unit,
    });
  }
  for (const cook of version.cookEvents) {
    for (const output of cook.outputs) {
      sources.set(output.outputId, {
        amount: output.quantity.amount,
        cookDate: cook.date,
        kind: "cook",
        optionRef: cook.option,
        unit: output.quantity.unit,
      });
    }
  }
  return sources;
};

type ValidationReason = MealPlanRuleViolation["reason"];
interface EventAllocation {
  readonly option: MealPlanOptionRef;
  readonly date: string;
  unit: string | null;
  amount: number;
}
interface CollectedCoverage {
  readonly optionEvents: Map<string, string>;
  readonly eventAllocations: Map<string, EventAllocation>;
}

const preparedSourceOptionFor = (
  cookEvents: MealPlanVersion["cookEvents"],
  authority: PlanningAuthority,
  outputId: string
): MealPlanOptionRef | null | undefined => {
  const stock = authority.content.preparedPortions.find(
    (portion) => portion.id === outputId
  );
  if (stock !== undefined) {
    return stock.sourceOptionRef;
  }
  return cookEvents.find((cook) =>
    cook.outputs.some((output) => output.outputId === outputId)
  )?.option;
};

const validatePreparedSourcePins = (
  version: MealPlanVersion,
  authority: PlanningAuthority,
  usedRefs: Set<string>
): ValidationReason | null => {
  const preparedOutputIds = new Set(
    version.coverage.flatMap(({ resolution }) =>
      resolution._tag === "Prepared" ? [resolution.outputId] : []
    )
  );
  if (version.pins.preparedSources.length !== preparedOutputIds.size) {
    return "content_version_changed";
  }
  for (const outputId of preparedOutputIds) {
    const pinned = version.pins.preparedSources.find(
      (entry) => entry.outputId === outputId
    );
    const current = preparedSourceOptionFor(
      version.cookEvents,
      authority,
      outputId
    );
    if (pinned === undefined) {
      return "content_version_changed";
    }
    if (pinned.optionRef === null) {
      if (current !== null && current !== undefined) {
        return "content_version_changed";
      }
      continue;
    }
    if (
      current === null ||
      current === undefined ||
      optionIdentity(pinned.optionRef) !== optionIdentity(current)
    ) {
      return "content_version_changed";
    }
    usedRefs.add(optionIdentity(current));
  }
  return null;
};

const validateContentPins = (
  version: MealPlanVersion,
  authority: PlanningAuthority
): ValidationReason | null => {
  const pinnedRefs = new Set(version.pins.content.map(optionIdentity));
  const pinnedSnapshots = new Set(
    version.pins.contentSnapshots.map(optionIdentity)
  );
  if (
    pinnedRefs.size !== pinnedSnapshots.size ||
    [...pinnedRefs].some((key) => !pinnedSnapshots.has(key))
  ) {
    return "content_version_changed";
  }
  for (const snapshot of version.pins.contentSnapshots) {
    const current = findExactOption(authority.content, snapshot);
    if (
      current === undefined ||
      JSON.stringify(Schema.encodeSync(MealOption)(snapshot)) !==
        JSON.stringify(Schema.encodeSync(MealOption)(current))
    ) {
      return "content_version_changed";
    }
  }
  const usedRefs = new Set<string>();
  for (const { resolution } of version.coverage) {
    if (resolution._tag === "MealOption") {
      usedRefs.add(optionIdentity(resolution.option));
    }
  }
  for (const cook of version.cookEvents) {
    usedRefs.add(optionIdentity(cook.option));
  }
  const preparedPinIssue = validatePreparedSourcePins(
    version,
    authority,
    usedRefs
  );
  if (preparedPinIssue !== null) {
    return preparedPinIssue;
  }
  return pinnedRefs.size === usedRefs.size &&
    [...usedRefs].every((key) => pinnedRefs.has(key))
    ? null
    : "content_version_changed";
};

const validatePins = (
  version: MealPlanVersion,
  authority: PlanningAuthority
): ValidationReason | null => {
  if (
    authority.people.length === 0 ||
    new Set(authority.people.map(({ personId }) => personId)).size !==
      authority.people.length ||
    version.pins.people.length !== authority.people.length
  ) {
    return "invalid_requirement_matrix";
  }
  if (version.pins.configVersion !== authority.content.configVersion) {
    return "config_version_changed";
  }
  for (const pin of version.pins.people) {
    const current = personFor(authority.people, pin.personId);
    if (
      current === undefined ||
      current.profileVersion !== pin.profileVersion ||
      current.safetyState !== pin.safetyState
    ) {
      return "profile_version_changed";
    }
  }
  const routines = [
    ...authority.content.routines,
    ...authority.content.oneOffRoutines,
  ];
  for (const pin of version.pins.routines) {
    if (
      !routines.some(
        (routine) =>
          routine.id === pin.routineId && routine.version === pin.routineVersion
      )
    ) {
      return "config_version_changed";
    }
  }
  return validateContentPins(version, authority);
};

const validateRequirementMatrix = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority
): ValidationReason | null => {
  const expected = requiredCoverage(request, authority);
  if (expected.length === 0) {
    return "config_missing";
  }
  const expectedKeys = new Set(expected.map(requirementIdentity));
  const actualKeys = version.coverage.map(({ requirement }) =>
    requirementIdentity(requirement)
  );
  return expected.length === version.coverage.length &&
    actualKeys.length === new Set(actualKeys).size &&
    actualKeys.every((key) => expectedKeys.has(key))
    ? null
    : "invalid_requirement_matrix";
};

const validateMealOptionCoverage = (
  resolution: Extract<MealPlanResolution, { _tag: "MealOption" }>,
  requirement: MealPlanRequirementKey,
  authority: PlanningAuthority,
  approval: boolean
): ValidationReason | null => {
  const person = personFor(authority.people, requirement.personId);
  if (person === undefined) {
    return "invalid_requirement_matrix";
  }
  const suitability = validateOptionForPerson(
    authority,
    person,
    resolution.option,
    approval
  );
  if (suitability !== null) {
    return suitability.reason;
  }
  if (!approval) {
    return null;
  }
  const option = findExactOption(authority.content, resolution.option);
  if (option === undefined || !isShoppingResolved(option)) {
    return "unresolved_shopping";
  }
  return preparationIssueForCoverage(authority, option, requirement);
};

const allocationConflicts = (
  existing: EventAllocation,
  resolution: Extract<MealPlanResolution, { _tag: "MealOption" }>,
  requirement: MealPlanRequirementKey
): boolean =>
  existing.date !== requirement.date ||
  (resolution.quantity !== null &&
    existing.unit !== null &&
    existing.unit !== resolution.quantity.unit);

const recordMealOptionAllocation = (
  resolution: Extract<MealPlanResolution, { _tag: "MealOption" }>,
  requirement: MealPlanRequirementKey,
  approval: boolean,
  collected: CollectedCoverage
): ValidationReason | null => {
  const optionKey = optionIdentity(resolution.option);
  const prior = collected.optionEvents.get(resolution.eventId);
  if (prior !== undefined && prior !== optionKey) {
    return "cook_event_conflict";
  }
  collected.optionEvents.set(resolution.eventId, optionKey);
  const existing = collected.eventAllocations.get(resolution.eventId);
  if (
    existing !== undefined &&
    allocationConflicts(existing, resolution, requirement)
  ) {
    return "cook_event_conflict";
  }
  if (
    approval &&
    resolution.option.kind !== "external" &&
    resolution.quantity === null
  ) {
    return "unresolved_allocation";
  }
  if (existing === undefined) {
    collected.eventAllocations.set(resolution.eventId, {
      amount: resolution.quantity?.amount ?? 0,
      date: requirement.date,
      option: resolution.option,
      unit: resolution.quantity?.unit ?? null,
    });
  } else {
    existing.amount += resolution.quantity?.amount ?? 0;
    existing.unit ??= resolution.quantity?.unit ?? null;
  }
  return null;
};

const collectCoverageEntry = (
  coverage: MealPlanCoverage,
  authority: PlanningAuthority,
  approval: boolean,
  collected: CollectedCoverage
): ValidationReason | null => {
  const { resolution, requirement } = coverage;
  if (resolution._tag === "Gap") {
    return approval ? "unresolved_gap" : null;
  }
  if (resolution._tag !== "MealOption") {
    return null;
  }
  const contentIssue = validateMealOptionCoverage(
    resolution,
    requirement,
    authority,
    approval
  );
  return (
    contentIssue ??
    recordMealOptionAllocation(resolution, requirement, approval, collected)
  );
};

const collectCoverage = (
  version: MealPlanVersion,
  authority: PlanningAuthority,
  approval: boolean
): CollectedCoverage | MealPlanRuleViolation => {
  const collected: CollectedCoverage = {
    eventAllocations: new Map(),
    optionEvents: new Map(),
  };
  for (const coverage of version.coverage) {
    const reason = collectCoverageEntry(
      coverage,
      authority,
      approval,
      collected
    );
    if (reason !== null) {
      return violation(reason);
    }
  }
  return collected;
};

const validateCookOutputs = (
  cook: MealPlanVersion["cookEvents"][number],
  option: PlanningContentSnapshot["options"][number],
  authority: PlanningAuthority,
  outputIds: Set<string>
): ValidationReason | null => {
  if (option.kind === "external") {
    return cook.outputs.length > 0 ? "invalid_cook_output" : null;
  }
  const yieldQuantity =
    option.kind === "packaged" ? option.quantity : option.yield;
  for (const output of cook.outputs) {
    if (
      outputIds.has(output.outputId) ||
      authority.content.preparedPortions.some(
        (item) => item.id === output.outputId
      )
    ) {
      return "invalid_cook_output";
    }
    if (
      yieldQuantity._tag === "Known" &&
      output.quantity.unit !== yieldQuantity.unit
    ) {
      return "quantity_unit_mismatch";
    }
    outputIds.add(output.outputId);
  }
  return null;
};

const validateCookEvents = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority,
  approval: boolean,
  collected: CollectedCoverage
): ValidationReason | null => {
  const eventIds = new Set<string>();
  const outputIds = new Set<string>();
  for (const cook of version.cookEvents) {
    const option = findExactOption(authority.content, cook.option);
    if (
      eventIds.has(cook.eventId) ||
      option === undefined ||
      cook.date < request.startDate ||
      cook.date >= dateAt(request.startDate, request.weeks * 7)
    ) {
      return "cook_event_conflict";
    }
    eventIds.add(cook.eventId);
    if (approval) {
      if (!isShoppingResolved(option)) {
        return "unresolved_shopping";
      }
      const preparation = preparationIssueForCook(authority, option, cook.date);
      if (preparation !== null) {
        return preparation;
      }
    }
    if (
      collected.optionEvents.has(cook.eventId) &&
      collected.optionEvents.get(cook.eventId) !== optionIdentity(cook.option)
    ) {
      return "cook_event_conflict";
    }
    const meal = collected.eventAllocations.get(cook.eventId);
    if (meal !== undefined && meal.date < cook.date) {
      return "cook_event_conflict";
    }
    const outputIssue = validateCookOutputs(cook, option, authority, outputIds);
    if (outputIssue !== null) {
      return outputIssue;
    }
  }
  return null;
};

const validateAllocatedYields = (
  version: MealPlanVersion,
  authority: PlanningAuthority,
  approval: boolean,
  allocations: ReadonlyMap<string, EventAllocation>
): ValidationReason | null => {
  for (const [eventId, allocation] of allocations) {
    const option = findExactOption(authority.content, allocation.option);
    if (option === undefined) {
      return "content_version_changed";
    }
    if (option.kind === "external") {
      continue;
    }
    const yieldQuantity =
      option.kind === "packaged" ? option.quantity : option.yield;
    if (yieldQuantity._tag !== "Known") {
      if (approval) {
        return "unresolved_shopping";
      }
      continue;
    }
    if (allocation.unit !== null && allocation.unit !== yieldQuantity.unit) {
      return "quantity_unit_mismatch";
    }
    const cook = version.cookEvents.find((entry) => entry.eventId === eventId);
    const matchingOutputs =
      cook?.outputs.reduce(
        (total, output) => total + output.quantity.amount,
        0
      ) ?? 0;
    if (
      allocation.amount + matchingOutputs >
      yieldQuantity.amount * (cook?.batchCount ?? 1) + 1e-9
    ) {
      return "prepared_overallocated";
    }
  }
  return null;
};

const validateUnallocatedCookYields = (
  version: MealPlanVersion,
  authority: PlanningAuthority,
  approval: boolean,
  allocations: ReadonlyMap<string, EventAllocation>
): ValidationReason | null => {
  for (const cook of version.cookEvents) {
    if (allocations.has(cook.eventId)) {
      continue;
    }
    const option = findExactOption(authority.content, cook.option);
    if (option === undefined) {
      return "content_version_changed";
    }
    if (option.kind === "external") {
      if (cook.outputs.length > 0) {
        return "invalid_cook_output";
      }
      continue;
    }
    const yieldQuantity =
      option.kind === "packaged" ? option.quantity : option.yield;
    if (yieldQuantity._tag !== "Known") {
      if (approval) {
        return "unresolved_shopping";
      }
      continue;
    }
    const produced = cook.outputs.reduce(
      (total, output) => total + output.quantity.amount,
      0
    );
    if (produced > yieldQuantity.amount * cook.batchCount + 1e-9) {
      return "prepared_overallocated";
    }
  }
  return null;
};

const validatePreparedCoverage = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority,
  approval: boolean
): ValidationReason | null => {
  const sources = sourceQuantities(version, authority, request);
  const used = new Map<string, number>();
  for (const { requirement, resolution } of version.coverage) {
    if (resolution._tag !== "Prepared") {
      continue;
    }
    const source = sources.get(resolution.outputId);
    if (source === undefined) {
      return "prepared_output_missing";
    }
    if (
      source.kind === "stock" &&
      source.confirmedWeek !== consumptionWeekStart(request, requirement.date)
    ) {
      return "prepared_output_missing";
    }
    if (
      source.kind === "cook" &&
      (requirement.date < source.cookDate ||
        consumptionWeekStart(request, requirement.date) !==
          consumptionWeekStart(request, source.cookDate))
    ) {
      return "prepared_output_missing";
    }
    if (source.unit !== resolution.quantity.unit) {
      return "quantity_unit_mismatch";
    }
    const next =
      (used.get(resolution.outputId) ?? 0) + resolution.quantity.amount;
    if (next > source.amount + 1e-9) {
      return "prepared_overallocated";
    }
    used.set(resolution.outputId, next);
    if (approval) {
      const person = personFor(authority.people, requirement.personId);
      if (person === undefined) {
        return "invalid_requirement_matrix";
      }
      if (source.optionRef === null) {
        return "unreviewed_suitability";
      }
      const suitability = validateOptionForPerson(
        authority,
        person,
        source.optionRef,
        true
      );
      if (suitability !== null) {
        return suitability.reason;
      }
    }
  }
  return null;
};

/** Validate a complete version against a fresh server-owned authority snapshot. */
export const validatePlanVersion = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority,
  approval: boolean
): MealPlanRuleViolation | null => {
  const pinIssue = validatePins(version, authority);
  if (pinIssue !== null) {
    return violation(pinIssue);
  }
  const matrixIssue = validateRequirementMatrix(version, request, authority);
  if (matrixIssue !== null) {
    return violation(matrixIssue);
  }
  const collected = collectCoverage(version, authority, approval);
  if ("_tag" in collected) {
    return collected;
  }
  const cookIssue = validateCookEvents(
    version,
    request,
    authority,
    approval,
    collected
  );
  if (cookIssue !== null) {
    return violation(cookIssue);
  }
  const allocatedYieldIssue = validateAllocatedYields(
    version,
    authority,
    approval,
    collected.eventAllocations
  );
  if (allocatedYieldIssue !== null) {
    return violation(allocatedYieldIssue);
  }
  const cookYieldIssue = validateUnallocatedCookYields(
    version,
    authority,
    approval,
    collected.eventAllocations
  );
  if (cookYieldIssue !== null) {
    return violation(cookYieldIssue);
  }
  const preparedIssue = validatePreparedCoverage(
    version,
    request,
    authority,
    approval
  );
  if (preparedIssue !== null) {
    return violation(preparedIssue);
  }
  if (approval) {
    const capacityIssue = cookingCapacityIssue(version, request, authority);
    if (capacityIssue !== null) {
      return violation(capacityIssue);
    }
  }
  return null;
};

const missingOutput = (
  reason: "dependent_output_removed" | "unavailable_prepared_food"
): MealPlanResolution => ({
  _tag: "Gap",
  rationale: "The prepared food for this meal is no longer available.",
  reason,
});

/** Repair downstream prepared meals after a cook event changes or disappears. */
export const repairPreparedDependencies = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority
): {
  readonly version: MealPlanVersion;
  readonly changed: readonly MealPlanRequirementKey[];
} => {
  const sources = sourceQuantities(version, authority, request);
  const used = new Map<string, number>();
  const changed: MealPlanRequirementKey[] = [];
  const coverage = version.coverage.map((entry): MealPlanCoverage => {
    if (entry.resolution._tag !== "Prepared") {
      return entry;
    }
    const { outputId, quantity } = entry.resolution;
    const source = sources.get(outputId);
    const next = (used.get(outputId) ?? 0) + quantity.amount;
    const unavailableDate =
      source !== undefined &&
      ((source.kind === "stock" &&
        source.confirmedWeek !==
          consumptionWeekStart(request, entry.requirement.date)) ||
        (source.kind === "cook" &&
          (entry.requirement.date < source.cookDate ||
            consumptionWeekStart(request, entry.requirement.date) !==
              consumptionWeekStart(request, source.cookDate))));
    if (
      source === undefined ||
      unavailableDate ||
      source.unit !== quantity.unit ||
      next > source.amount + 1e-9
    ) {
      changed.push(entry.requirement);
      return {
        ...entry,
        resolution: missingOutput(
          source === undefined
            ? "dependent_output_removed"
            : "unavailable_prepared_food"
        ),
      };
    }
    used.set(outputId, next);
    return entry;
  });
  return { changed, version: { ...version, coverage } };
};

const pinsFor = (
  authority: PlanningAuthority,
  coverage: readonly MealPlanCoverage[],
  cookEvents: MealPlanVersion["cookEvents"]
): MealPlanVersion["pins"] => {
  const content = new Map<string, MealPlanOptionRef>();
  for (const { resolution } of coverage) {
    if (resolution._tag === "MealOption") {
      content.set(optionIdentity(resolution.option), resolution.option);
    }
  }
  for (const cook of cookEvents) {
    content.set(optionIdentity(cook.option), cook.option);
  }
  const preparedSources = [
    ...new Set(
      coverage.flatMap(({ resolution }) =>
        resolution._tag === "Prepared" ? [resolution.outputId] : []
      )
    ),
  ].map((outputId) => {
    const optionRef =
      preparedSourceOptionFor(cookEvents, authority, outputId) ?? null;
    if (optionRef !== null) {
      content.set(optionIdentity(optionRef), optionRef);
    }
    return { optionRef, outputId };
  });
  return {
    configVersion: authority.content.configVersion,
    content: [...content.values()],
    contentSnapshots: [...content.values()].flatMap((reference) => {
      const option = findExactOption(authority.content, reference);
      return option === undefined ? [] : [option];
    }),
    people: authority.people,
    preparedSources,
    routines: [
      ...authority.content.routines.filter(({ state }) => state === "active"),
      ...authority.content.oneOffRoutines,
    ].map(({ id, version }) => ({ routineId: id, routineVersion: version })),
  };
};

export const repinPlanVersion = (
  version: MealPlanVersion,
  authority: PlanningAuthority
): MealPlanVersion => ({
  ...version,
  pins: pinsFor(authority, version.coverage, version.cookEvents),
});

export const makeInitialPlanVersion = (
  request: MealPlanRequest,
  authority: PlanningAuthority,
  initialCoverage: readonly MealPlanCoverage[] = []
): MealPlanVersion => {
  const byKey = new Map(
    initialCoverage.map((entry) => [
      requirementIdentity(entry.requirement),
      entry,
    ])
  );
  const eventIds = new Map<string, string>();
  const eventIdFor = (key: string): string => {
    const existing = eventIds.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const id = `event_${eventIds.size + 1}`;
    eventIds.set(key, id);
    return id;
  };
  const plannedOption = (
    requirement: MealPlanRequirementKey,
    optionRef: MealPlanOptionRef,
    eventId: string,
    rationale: string
  ): MealPlanResolution => {
    const option = findExactOption(authority.content, optionRef);
    if (option === undefined) {
      return gap(
        "no_compatible_option",
        "This saved food option is no longer available."
      );
    }
    const preparationIssue = preparationIssueForCoverage(
      authority,
      option,
      requirement
    );
    if (preparationIssue !== null) {
      return gap(
        "preparation_context_unresolved",
        `Review this meal's equipment or preparation window: ${preparationIssue}.`
      );
    }
    return {
      _tag: "MealOption",
      eventId,
      option: optionRef,
      quantity: null,
      rationale,
    };
  };
  const coverage = requiredCoverage(request, authority).map(
    (requirement): MealPlanCoverage => {
      const supplied = byKey.get(requirementIdentity(requirement));
      if (supplied !== undefined) {
        return supplied;
      }
      const person = personFor(authority.people, requirement.personId);
      if (person === undefined) {
        return {
          requirement,
          resolution: gap(
            "not_planned",
            "This person needs a saved planning profile."
          ),
        };
      }
      const weekday = new Date(`${requirement.date}T00:00:00.000Z`).getUTCDay();
      const routine = resolveRoutineForCoverage(authority.content, {
        profileVersion: person.profileVersion,
        requirement: {
          date: requirement.date,
          occasionId: requirement.occasion,
          personId: requirement.personId,
          weekday,
        },
        safetyState: person.safetyState,
      });
      if (routine._tag === "Conflict") {
        return {
          requirement,
          resolution: gap(
            "routine_conflict",
            "Conflicting routines need an adult choice."
          ),
        };
      }
      if (routine._tag === "BlockedSuitability") {
        const location =
          authority.content.availability.find(
            (entry) =>
              entry.personId === requirement.personId &&
              entry.occasionId === requirement.occasion &&
              entry.weekdays.includes(weekday)
          )?.location ?? "home";
        const fallback = resolveFallbackForCoverage(authority.content, {
          location,
          occasionId: requirement.occasion,
          personId: person.personId,
          profileVersion: person.profileVersion,
          safetyState: person.safetyState,
        });
        if (fallback._tag === "Selected") {
          return {
            requirement,
            resolution: plannedOption(
              requirement,
              fallback.optionRef,
              eventIdFor(
                `${requirementIdentity(requirement)}|${optionIdentity(fallback.optionRef)}`
              ),
              `Approved fallback ${fallback.fallbackId} covers this person's meal.`
            ),
          };
        }
        return {
          requirement,
          resolution: gap(
            "unconfirmed_suitability",
            "The routine meal needs suitability review or an approved fallback."
          ),
        };
      }
      if (routine._tag === "NoRoutine") {
        return {
          requirement,
          resolution: gap(
            "not_planned",
            "No saved routine covers this occasion yet."
          ),
        };
      }
      const rationale = `Applied ${routine.source.scope} routine ${routine.source.id}.`;
      switch (routine.choice._tag) {
        case "Skip": {
          return { requirement, resolution: { _tag: "Skip", rationale } };
        }
        case "Flexible": {
          return { requirement, resolution: { _tag: "Flexible", rationale } };
        }
        case "Leftover": {
          return {
            requirement,
            resolution: gap(
              "unavailable_prepared_food",
              "Choose a confirmed prepared portion for this leftover routine."
            ),
          };
        }
        case "External": {
          return {
            requirement,
            resolution: plannedOption(
              requirement,
              routine.choice.optionRef,
              eventIdFor(
                `${requirement.date}|${requirement.occasion}|${optionIdentity(routine.choice.optionRef)}`
              ),
              rationale
            ),
          };
        }
        case "Options": {
          const offset = Math.floor(
            (Date.parse(`${requirement.date}T00:00:00.000Z`) -
              Date.parse(`${request.startDate}T00:00:00.000Z`)) /
              86_400_000
          );
          const selected =
            routine.choice.optionRefs[
              routine.choice.selection === "rotate"
                ? offset % routine.choice.optionRefs.length
                : 0
            ];
          if (selected === undefined) {
            return {
              requirement,
              resolution: gap(
                "no_compatible_option",
                "The routine has no available meal option."
              ),
            };
          }
          return {
            requirement,
            resolution: plannedOption(
              requirement,
              selected,
              eventIdFor(
                `${requirement.date}|${requirement.occasion}|${optionIdentity(selected)}`
              ),
              rationale
            ),
          };
        }
        default: {
          return casesHandled(routine.choice);
        }
      }
    }
  );
  return {
    cookEvents: [],
    coverage,
    number: 1,
    pins: pinsFor(authority, coverage, []),
  };
};

/** Update only a proposed version when authoritative inputs changed. */
export const rebasePlanVersion = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority
): {
  readonly version: MealPlanVersion;
  readonly changed: readonly MealPlanRequirementKey[];
} => {
  const old = new Map(
    version.coverage.map((entry) => [
      requirementIdentity(entry.requirement),
      entry,
    ])
  );
  const changed: MealPlanRequirementKey[] = [];
  const coverage = requiredCoverage(request, authority).map(
    (requirement): MealPlanCoverage => {
      const prior = old.get(requirementIdentity(requirement));
      if (prior === undefined) {
        changed.push(requirement);
        return {
          requirement,
          resolution: {
            _tag: "Gap",
            rationale: "This occasion was added after the earlier plan.",
            reason: "not_planned",
          },
        };
      }
      if (prior.resolution._tag !== "MealOption") {
        return prior;
      }
      const person = personFor(authority.people, requirement.personId);
      if (
        person === undefined ||
        validateOptionForPerson(
          authority,
          person,
          prior.resolution.option,
          true
        ) !== null
      ) {
        changed.push(requirement);
        return {
          requirement,
          resolution: {
            _tag: "Gap",
            rationale:
              "This meal needs review against the current person and content versions.",
            reason: "unconfirmed_suitability",
          },
        };
      }
      const option = findExactOption(
        authority.content,
        prior.resolution.option
      );
      if (
        option === undefined ||
        preparationIssueForCoverage(authority, option, requirement) !== null
      ) {
        changed.push(requirement);
        return {
          requirement,
          resolution: {
            _tag: "Gap",
            rationale:
              "The saved equipment or preparation window changed; review this meal.",
            reason: "preparation_context_unresolved",
          },
        };
      }
      return prior;
    }
  );
  const cookEvents = version.cookEvents.filter((cook) => {
    const option = findExactOption(authority.content, cook.option);
    return (
      option !== undefined &&
      validateCookOutputs(cook, option, authority, new Set()) === null
    );
  });
  const rebased: MealPlanVersion = {
    ...version,
    cookEvents,
    coverage,
  };
  const repaired = repairPreparedDependencies(rebased, request, authority);
  return {
    changed: [...changed, ...repaired.changed],
    version: repinPlanVersion(repaired.version, authority),
  };
};

export const changePlanVersion = (
  version: MealPlanVersion,
  change: MealPlanChange,
  request: MealPlanRequest,
  authority: PlanningAuthority
):
  | {
      readonly version: MealPlanVersion;
      readonly changed: readonly MealPlanRequirementKey[];
    }
  | MealPlanRuleViolation => {
  const changed: MealPlanRequirementKey[] = [];
  let next = version;
  switch (change._tag) {
    case "RefreshInputs": {
      return violation("config_version_changed");
    }
    case "ReplaceDraftPlan": {
      const prior = new Map(
        version.coverage.map((entry) => [
          requirementIdentity(entry.requirement),
          entry,
        ])
      );
      for (const entry of change.coverage) {
        const old = prior.get(requirementIdentity(entry.requirement));
        if (
          old === undefined ||
          JSON.stringify(old.resolution) !== JSON.stringify(entry.resolution)
        ) {
          changed.push(entry.requirement);
        }
      }
      next = {
        ...version,
        cookEvents: change.cookEvents,
        coverage: change.coverage,
      };
      break;
    }
    case "SetCoverage": {
      const key = requirementIdentity(change.requirement);
      const index = version.coverage.findIndex(
        ({ requirement }) => requirementIdentity(requirement) === key
      );
      if (index === -1) {
        return violation("requirement_not_found");
      }
      const coverage = [...version.coverage];
      coverage[index] = {
        requirement: change.requirement,
        resolution: change.resolution,
      };
      changed.push(change.requirement);
      next = { ...version, coverage };
      break;
    }
    case "ReplaceMealEvent": {
      const coverage = version.coverage.map((entry) => {
        if (
          entry.resolution._tag !== "MealOption" ||
          entry.resolution.eventId !== change.eventId
        ) {
          return entry;
        }
        changed.push(entry.requirement);
        return {
          ...entry,
          resolution: {
            ...entry.resolution,
            option: change.option,
            rationale: change.rationale,
          },
        };
      });
      if (changed.length === 0) {
        return violation("requirement_not_found");
      }
      // Replacing a cook event removes its old outputs until an adult confirms new production.
      next = {
        ...version,
        cookEvents: version.cookEvents.filter(
          ({ eventId }) => eventId !== change.eventId
        ),
        coverage,
      };
      break;
    }
    case "SetCookEvent": {
      const cookEvents = version.cookEvents.filter(
        ({ eventId }) => eventId !== change.event.eventId
      );
      cookEvents.push(change.event);
      next = { ...version, cookEvents };
      break;
    }
    case "RemoveCookEvent": {
      if (
        !version.cookEvents.some(({ eventId }) => eventId === change.eventId)
      ) {
        return violation("cook_event_conflict");
      }
      next = {
        ...version,
        cookEvents: version.cookEvents.filter(
          ({ eventId }) => eventId !== change.eventId
        ),
      };
      break;
    }
    default: {
      return casesHandled(change);
    }
  }
  const repaired = repairPreparedDependencies(next, request, authority);
  const repinned = repinPlanVersion(repaired.version, authority);
  const issue = validatePlanVersion(repinned, request, authority, false);
  if (issue !== null) {
    return issue;
  }
  return { changed: [...changed, ...repaired.changed], version: repinned };
};
