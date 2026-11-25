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
  currentOptionFor,
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

const violation = (reason: MealPlanRuleViolation["reason"]) => {
  const checkedResult: MealPlanRuleViolation = {
    _tag: "MealPlanRuleViolation",
    reason,
  };
  return checkedResult;
};
const casesHandled = (value: never): never => {
  throw new Error(`Unexpected meal plan variant: ${String(value)}`);
};
const gap = (
  reason: Extract<MealPlanResolution, { _tag: "Gap" }>["reason"],
  rationale: string
) => {
  const checkedResult: MealPlanResolution = { _tag: "Gap", rationale, reason };
  return checkedResult;
};

export const requirementIdentity = (requirement: MealPlanRequirementKey) => {
  const checkedResult = `${requirement.personId}\u0000${requirement.date}\u0000${requirement.occasion}`;
  return checkedResult;
};

const optionIdentity = (option: {
  readonly optionId: string;
  readonly optionVersion: number;
  readonly kind: string;
}) => {
  const checkedResult = `${option.optionId}\u0000${option.optionVersion}\u0000${option.kind}`;
  return checkedResult;
};

const dateAt = (start: string, offset: number) => {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  {
    const checkedResult: string = date.toISOString().slice(0, 10);
    return checkedResult;
  }
};

/** Expand the saved per-person occasion configuration into dated requirements. */
export const requiredCoverage = (
  request: MealPlanRequest,
  authority: PlanningAuthority
) => {
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
  {
    const checkedResult: readonly MealPlanRequirementKey[] = [
      ...requirements.values(),
    ].toSorted((left, right) =>
      requirementIdentity(left).localeCompare(requirementIdentity(right))
    );
    return checkedResult;
  }
};

const preparationIssueForCoverage = (
  authority: PlanningAuthority,
  option: NonNullable<ReturnType<typeof currentOptionFor>>,
  requirement: MealPlanRequirementKey
) => {
  const weekday = new Date(`${requirement.date}T00:00:00.000Z`).getUTCDay();
  const matches = authority.content.availability.filter(
    (entry) =>
      entry.personId === requirement.personId &&
      entry.occasionId === requirement.occasion &&
      entry.weekdays.includes(weekday)
  );
  if (matches.length !== 1 && option.kind !== "external") {
    const checkedResult: MealPlanRuleViolation["reason"] | null =
      "availability_unknown";
    return checkedResult;
  }
  {
    const checkedResult: MealPlanRuleViolation["reason"] | null =
      optionPreparationIssue(
        option,
        matches[0],
        authority.content.cookingCapacity
      );
    return checkedResult;
  }
};

const preparationIssueForCook = (
  authority: PlanningAuthority,
  option: NonNullable<ReturnType<typeof currentOptionFor>>,
  date: string
) => {
  if (option.kind === "external") {
    const checkedResult: MealPlanRuleViolation["reason"] | null = null;
    return checkedResult;
  }
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const candidates = authority.content.availability.filter(
    (entry) =>
      entry.weekdays.includes(weekday) &&
      authority.people.some((person) => person.personId === entry.personId)
  );
  if (candidates.length === 0) {
    const checkedResult: MealPlanRuleViolation["reason"] | null =
      "availability_unknown";
    return checkedResult;
  }
  const issues = candidates.map((entry) =>
    optionPreparationIssue(option, entry, authority.content.cookingCapacity)
  );
  {
    const checkedResult: MealPlanRuleViolation["reason"] | null =
      issues.includes(null) ? null : (issues[0] ?? "availability_unknown");
    return checkedResult;
  }
};

const personFor = (people: readonly MealPlanPersonPin[], personId: string) => {
  const checkedResult: MealPlanPersonPin | undefined = people.find(
    (person) => person.personId === personId
  );
  return checkedResult;
};

const validateOptionForPerson = (
  authority: PlanningAuthority,
  person: MealPlanPersonPin,
  option: MealPlanOptionRef,
  approval: boolean
) => {
  if (currentOptionFor(authority.content, option) === undefined) {
    const checkedResult: MealPlanRuleViolation | null = violation(
      "content_version_changed"
    );
    return checkedResult;
  }
  const issue = contentSuitabilityIssue(authority.content, {
    optionRef: option,
    personId: person.personId,
    profileVersion: person.profileVersion,
    safetyState: person.safetyState,
  });
  if (issue === "incompatible") {
    const checkedResult: MealPlanRuleViolation | null = violation(
      "incompatible_option"
    );
    return checkedResult;
  }
  if (approval && issue !== null) {
    const checkedResult: MealPlanRuleViolation | null = violation(
      "unreviewed_suitability"
    );
    return checkedResult;
  }
  {
    const checkedResult: MealPlanRuleViolation | null = null;
    return checkedResult;
  }
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
) => {
  const day = Math.floor(
    (Date.parse(`${date}T00:00:00.000Z`) -
      Date.parse(`${request.startDate}T00:00:00.000Z`)) /
      86_400_000
  );
  {
    const checkedResult: MealPlanRequirementKey["date"] = MealPlanDate.make(
      dateAt(request.startDate, Math.floor(day / 7) * 7)
    );
    return checkedResult;
  }
};

const cookingCapacityIssue = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority
) => {
  const eventsByWeek = new Map<string, Set<string>>();
  const count = (
    eventId: string,
    date: string,
    optionRef: MealPlanOptionRef
  ) => {
    const option = currentOptionFor(authority.content, optionRef);
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
  {
    const checkedResult: MealPlanRuleViolation["reason"] | null = [
      ...eventsByWeek.values(),
    ].some(
      (events) =>
        events.size >
        authority.content.cookingCapacity.maximumSubstantialCookEventsPerWeek
    )
      ? "cooking_capacity_exceeded"
      : null;
    return checkedResult;
  }
};

const sourceQuantities = (
  version: MealPlanVersion,
  authority: PlanningAuthority,
  request: MealPlanRequest
) => {
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
  {
    const checkedResult: Map<string, PreparedSource> = sources;
    return checkedResult;
  }
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
) => {
  const stock = authority.content.preparedPortions.find(
    (portion) => portion.id === outputId
  );
  if (stock !== undefined) {
    const checkedResult: MealPlanOptionRef | null | undefined =
      stock.sourceOptionRef;
    return checkedResult;
  }
  {
    const checkedResult: MealPlanOptionRef | null | undefined = cookEvents.find(
      (cook) => cook.outputs.some((output) => output.outputId === outputId)
    )?.option;
    return checkedResult;
  }
};

const validatePreparedSourcePins = (
  version: MealPlanVersion,
  authority: PlanningAuthority,
  usedRefs: Set<string>
) => {
  const preparedOutputIds = new Set(
    version.coverage.flatMap(({ resolution }) =>
      resolution._tag === "Prepared" ? [resolution.outputId] : []
    )
  );
  if (version.pins.preparedSources.length !== preparedOutputIds.size) {
    const checkedResult: ValidationReason | null = "content_version_changed";
    return checkedResult;
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
      const checkedResult: ValidationReason | null = "content_version_changed";
      return checkedResult;
    }
    if (pinned.optionRef === null) {
      if (current !== null && current !== undefined) {
        const checkedResult: ValidationReason | null =
          "content_version_changed";
        return checkedResult;
      }
      continue;
    }
    if (
      current === null ||
      current === undefined ||
      optionIdentity(pinned.optionRef) !== optionIdentity(current)
    ) {
      const checkedResult: ValidationReason | null = "content_version_changed";
      return checkedResult;
    }
    usedRefs.add(optionIdentity(current));
  }
  {
    const checkedResult: ValidationReason | null = null;
    return checkedResult;
  }
};

const validateContentPins = (
  version: MealPlanVersion,
  authority: PlanningAuthority
) => {
  const pinnedRefs = new Set(version.pins.content.map(optionIdentity));
  const pinnedSnapshots = new Set(
    version.pins.contentSnapshots.map(optionIdentity)
  );
  if (
    pinnedRefs.size !== pinnedSnapshots.size ||
    [...pinnedRefs].some((key) => !pinnedSnapshots.has(key))
  ) {
    const checkedResult: ValidationReason | null = "content_version_changed";
    return checkedResult;
  }
  for (const snapshot of version.pins.contentSnapshots) {
    const current = currentOptionFor(authority.content, snapshot);
    if (
      current === undefined ||
      JSON.stringify(Schema.encodeSync(MealOption)(snapshot)) !==
        JSON.stringify(Schema.encodeSync(MealOption)(current))
    ) {
      const checkedResult: ValidationReason | null = "content_version_changed";
      return checkedResult;
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
    const checkedResult: ValidationReason | null = preparedPinIssue;
    return checkedResult;
  }
  {
    const checkedResult: ValidationReason | null =
      pinnedRefs.size === usedRefs.size &&
      [...usedRefs].every((key) => pinnedRefs.has(key))
        ? null
        : "content_version_changed";
    return checkedResult;
  }
};

const validatePins = (
  version: MealPlanVersion,
  authority: PlanningAuthority
) => {
  if (
    authority.people.length === 0 ||
    new Set(authority.people.map(({ personId }) => personId)).size !==
      authority.people.length ||
    version.pins.people.length !== authority.people.length
  ) {
    const checkedResult: ValidationReason | null = "invalid_requirement_matrix";
    return checkedResult;
  }
  if (version.pins.configVersion !== authority.content.configVersion) {
    const checkedResult: ValidationReason | null = "config_version_changed";
    return checkedResult;
  }
  for (const pin of version.pins.people) {
    const current = personFor(authority.people, pin.personId);
    if (
      current === undefined ||
      current.profileVersion !== pin.profileVersion ||
      current.safetyState !== pin.safetyState
    ) {
      const checkedResult: ValidationReason | null = "profile_version_changed";
      return checkedResult;
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
      const checkedResult: ValidationReason | null = "config_version_changed";
      return checkedResult;
    }
  }
  {
    const checkedResult: ValidationReason | null = validateContentPins(
      version,
      authority
    );
    return checkedResult;
  }
};

const validateRequirementMatrix = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority
) => {
  const expected = requiredCoverage(request, authority);
  if (expected.length === 0) {
    const checkedResult: ValidationReason | null = "config_missing";
    return checkedResult;
  }
  const expectedKeys = new Set(expected.map(requirementIdentity));
  const actualKeys = version.coverage.map(({ requirement }) =>
    requirementIdentity(requirement)
  );
  {
    const checkedResult: ValidationReason | null =
      expected.length === version.coverage.length &&
      actualKeys.length === new Set(actualKeys).size &&
      actualKeys.every((key) => expectedKeys.has(key))
        ? null
        : "invalid_requirement_matrix";
    return checkedResult;
  }
};

const validateMealOptionCoverage = (
  resolution: Extract<MealPlanResolution, { _tag: "MealOption" }>,
  requirement: MealPlanRequirementKey,
  authority: PlanningAuthority,
  approval: boolean
) => {
  const person = personFor(authority.people, requirement.personId);
  if (person === undefined) {
    const checkedResult: ValidationReason | null = "invalid_requirement_matrix";
    return checkedResult;
  }
  const suitability = validateOptionForPerson(
    authority,
    person,
    resolution.option,
    approval
  );
  if (suitability !== null) {
    const checkedResult: ValidationReason | null = suitability.reason;
    return checkedResult;
  }
  if (!approval) {
    const checkedResult: ValidationReason | null = null;
    return checkedResult;
  }
  const option = currentOptionFor(authority.content, resolution.option);
  if (option === undefined || !isShoppingResolved(option)) {
    const checkedResult: ValidationReason | null = "unresolved_shopping";
    return checkedResult;
  }
  {
    const checkedResult: ValidationReason | null = preparationIssueForCoverage(
      authority,
      option,
      requirement
    );
    return checkedResult;
  }
};

const allocationConflicts = (
  existing: EventAllocation,
  resolution: Extract<MealPlanResolution, { _tag: "MealOption" }>,
  requirement: MealPlanRequirementKey
) => {
  const checkedResult: boolean =
    existing.date !== requirement.date ||
    (resolution.quantity !== null &&
      existing.unit !== null &&
      existing.unit !== resolution.quantity.unit);
  return checkedResult;
};

const recordMealOptionAllocation = (
  resolution: Extract<MealPlanResolution, { _tag: "MealOption" }>,
  requirement: MealPlanRequirementKey,
  approval: boolean,
  collected: CollectedCoverage
) => {
  const optionKey = optionIdentity(resolution.option);
  const prior = collected.optionEvents.get(resolution.eventId);
  if (prior !== undefined && prior !== optionKey) {
    const checkedResult: ValidationReason | null = "cook_event_conflict";
    return checkedResult;
  }
  collected.optionEvents.set(resolution.eventId, optionKey);
  const existing = collected.eventAllocations.get(resolution.eventId);
  if (
    existing !== undefined &&
    allocationConflicts(existing, resolution, requirement)
  ) {
    const checkedResult: ValidationReason | null = "cook_event_conflict";
    return checkedResult;
  }
  if (
    approval &&
    resolution.option.kind !== "external" &&
    resolution.quantity === null
  ) {
    const checkedResult: ValidationReason | null = "unresolved_allocation";
    return checkedResult;
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
  {
    const checkedResult: ValidationReason | null = null;
    return checkedResult;
  }
};

const collectCoverageEntry = (
  coverage: MealPlanCoverage,
  authority: PlanningAuthority,
  approval: boolean,
  collected: CollectedCoverage
) => {
  const { resolution, requirement } = coverage;
  if (resolution._tag === "Gap") {
    const checkedResult: ValidationReason | null = approval
      ? "unresolved_gap"
      : null;
    return checkedResult;
  }
  if (resolution._tag !== "MealOption") {
    const checkedResult: ValidationReason | null = null;
    return checkedResult;
  }
  const contentIssue = validateMealOptionCoverage(
    resolution,
    requirement,
    authority,
    approval
  );
  {
    const checkedResult: ValidationReason | null =
      contentIssue ??
      recordMealOptionAllocation(resolution, requirement, approval, collected);
    return checkedResult;
  }
};

const collectCoverage = (
  version: MealPlanVersion,
  authority: PlanningAuthority,
  approval: boolean
) => {
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
      const checkedResult: CollectedCoverage | MealPlanRuleViolation =
        violation(reason);
      return checkedResult;
    }
  }
  {
    const checkedResult: CollectedCoverage | MealPlanRuleViolation = collected;
    return checkedResult;
  }
};

const validateCookOutputs = (
  cook: MealPlanVersion["cookEvents"][number],
  option: PlanningContentSnapshot["options"][number],
  authority: PlanningAuthority,
  outputIds: Set<string>
) => {
  if (option.kind === "external") {
    const checkedResult: ValidationReason | null =
      cook.outputs.length > 0 ? "invalid_cook_output" : null;
    return checkedResult;
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
      const checkedResult: ValidationReason | null = "invalid_cook_output";
      return checkedResult;
    }
    if (
      yieldQuantity._tag === "Known" &&
      output.quantity.unit !== yieldQuantity.unit
    ) {
      const checkedResult: ValidationReason | null = "quantity_unit_mismatch";
      return checkedResult;
    }
    outputIds.add(output.outputId);
  }
  {
    const checkedResult: ValidationReason | null = null;
    return checkedResult;
  }
};

const validateCookEvents = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority,
  approval: boolean,
  collected: CollectedCoverage
) => {
  const eventIds = new Set<string>();
  const outputIds = new Set<string>();
  for (const cook of version.cookEvents) {
    const option = currentOptionFor(authority.content, cook.option);
    if (
      eventIds.has(cook.eventId) ||
      option === undefined ||
      cook.date < request.startDate ||
      cook.date >= dateAt(request.startDate, request.weeks * 7)
    ) {
      const checkedResult: ValidationReason | null = "cook_event_conflict";
      return checkedResult;
    }
    eventIds.add(cook.eventId);
    if (approval) {
      if (!isShoppingResolved(option)) {
        const checkedResult: ValidationReason | null = "unresolved_shopping";
        return checkedResult;
      }
      const preparation = preparationIssueForCook(authority, option, cook.date);
      if (preparation !== null) {
        const checkedResult: ValidationReason | null = preparation;
        return checkedResult;
      }
    }
    if (
      collected.optionEvents.has(cook.eventId) &&
      collected.optionEvents.get(cook.eventId) !== optionIdentity(cook.option)
    ) {
      const checkedResult: ValidationReason | null = "cook_event_conflict";
      return checkedResult;
    }
    const meal = collected.eventAllocations.get(cook.eventId);
    if (meal !== undefined && meal.date < cook.date) {
      const checkedResult: ValidationReason | null = "cook_event_conflict";
      return checkedResult;
    }
    const outputIssue = validateCookOutputs(cook, option, authority, outputIds);
    if (outputIssue !== null) {
      const checkedResult: ValidationReason | null = outputIssue;
      return checkedResult;
    }
  }
  {
    const checkedResult: ValidationReason | null = null;
    return checkedResult;
  }
};

const validateAllocatedYields = (
  version: MealPlanVersion,
  authority: PlanningAuthority,
  approval: boolean,
  allocations: ReadonlyMap<string, EventAllocation>
) => {
  for (const [eventId, allocation] of allocations) {
    const option = currentOptionFor(authority.content, allocation.option);
    if (option === undefined) {
      const checkedResult: ValidationReason | null = "content_version_changed";
      return checkedResult;
    }
    if (option.kind === "external") {
      continue;
    }
    const yieldQuantity =
      option.kind === "packaged" ? option.quantity : option.yield;
    if (yieldQuantity._tag !== "Known") {
      if (approval) {
        const checkedResult: ValidationReason | null = "unresolved_shopping";
        return checkedResult;
      }
      continue;
    }
    if (allocation.unit !== null && allocation.unit !== yieldQuantity.unit) {
      const checkedResult: ValidationReason | null = "quantity_unit_mismatch";
      return checkedResult;
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
      const checkedResult: ValidationReason | null = "prepared_overallocated";
      return checkedResult;
    }
  }
  {
    const checkedResult: ValidationReason | null = null;
    return checkedResult;
  }
};

const validateUnallocatedCookYields = (
  version: MealPlanVersion,
  authority: PlanningAuthority,
  approval: boolean,
  allocations: ReadonlyMap<string, EventAllocation>
) => {
  for (const cook of version.cookEvents) {
    if (allocations.has(cook.eventId)) {
      continue;
    }
    const option = currentOptionFor(authority.content, cook.option);
    if (option === undefined) {
      const checkedResult: ValidationReason | null = "content_version_changed";
      return checkedResult;
    }
    if (option.kind === "external") {
      if (cook.outputs.length > 0) {
        const checkedResult: ValidationReason | null = "invalid_cook_output";
        return checkedResult;
      }
      continue;
    }
    const yieldQuantity =
      option.kind === "packaged" ? option.quantity : option.yield;
    if (yieldQuantity._tag !== "Known") {
      if (approval) {
        const checkedResult: ValidationReason | null = "unresolved_shopping";
        return checkedResult;
      }
      continue;
    }
    const produced = cook.outputs.reduce(
      (total, output) => total + output.quantity.amount,
      0
    );
    if (produced > yieldQuantity.amount * cook.batchCount + 1e-9) {
      const checkedResult: ValidationReason | null = "prepared_overallocated";
      return checkedResult;
    }
  }
  {
    const checkedResult: ValidationReason | null = null;
    return checkedResult;
  }
};

const validatePreparedCoverage = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority,
  approval: boolean
) => {
  const sources = sourceQuantities(version, authority, request);
  const used = new Map<string, number>();
  for (const { requirement, resolution } of version.coverage) {
    if (resolution._tag !== "Prepared") {
      continue;
    }
    const source = sources.get(resolution.outputId);
    if (source === undefined) {
      const checkedResult: ValidationReason | null = "prepared_output_missing";
      return checkedResult;
    }
    if (
      source.kind === "stock" &&
      source.confirmedWeek !== consumptionWeekStart(request, requirement.date)
    ) {
      const checkedResult: ValidationReason | null = "prepared_output_missing";
      return checkedResult;
    }
    if (
      source.kind === "cook" &&
      (requirement.date < source.cookDate ||
        consumptionWeekStart(request, requirement.date) !==
          consumptionWeekStart(request, source.cookDate))
    ) {
      const checkedResult: ValidationReason | null = "prepared_output_missing";
      return checkedResult;
    }
    if (source.unit !== resolution.quantity.unit) {
      const checkedResult: ValidationReason | null = "quantity_unit_mismatch";
      return checkedResult;
    }
    const next =
      (used.get(resolution.outputId) ?? 0) + resolution.quantity.amount;
    if (next > source.amount + 1e-9) {
      const checkedResult: ValidationReason | null = "prepared_overallocated";
      return checkedResult;
    }
    used.set(resolution.outputId, next);
    if (approval) {
      const person = personFor(authority.people, requirement.personId);
      if (person === undefined) {
        const checkedResult: ValidationReason | null =
          "invalid_requirement_matrix";
        return checkedResult;
      }
      if (source.optionRef === null) {
        const checkedResult: ValidationReason | null = "unreviewed_suitability";
        return checkedResult;
      }
      const suitability = validateOptionForPerson(
        authority,
        person,
        source.optionRef,
        true
      );
      if (suitability !== null) {
        const checkedResult: ValidationReason | null = suitability.reason;
        return checkedResult;
      }
    }
  }
  {
    const checkedResult: ValidationReason | null = null;
    return checkedResult;
  }
};

/** Validate a complete version against a fresh server-owned authority snapshot. */
export const validatePlanVersion = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority,
  approval: boolean
) => {
  const pinIssue = validatePins(version, authority);
  if (pinIssue !== null) {
    const checkedResult: MealPlanRuleViolation | null = violation(pinIssue);
    return checkedResult;
  }
  const matrixIssue = validateRequirementMatrix(version, request, authority);
  if (matrixIssue !== null) {
    const checkedResult: MealPlanRuleViolation | null = violation(matrixIssue);
    return checkedResult;
  }
  const collected = collectCoverage(version, authority, approval);
  if ("_tag" in collected) {
    const checkedResult: MealPlanRuleViolation | null = collected;
    return checkedResult;
  }
  const cookIssue = validateCookEvents(
    version,
    request,
    authority,
    approval,
    collected
  );
  if (cookIssue !== null) {
    const checkedResult: MealPlanRuleViolation | null = violation(cookIssue);
    return checkedResult;
  }
  const allocatedYieldIssue = validateAllocatedYields(
    version,
    authority,
    approval,
    collected.eventAllocations
  );
  if (allocatedYieldIssue !== null) {
    const checkedResult: MealPlanRuleViolation | null =
      violation(allocatedYieldIssue);
    return checkedResult;
  }
  const cookYieldIssue = validateUnallocatedCookYields(
    version,
    authority,
    approval,
    collected.eventAllocations
  );
  if (cookYieldIssue !== null) {
    const checkedResult: MealPlanRuleViolation | null =
      violation(cookYieldIssue);
    return checkedResult;
  }
  const preparedIssue = validatePreparedCoverage(
    version,
    request,
    authority,
    approval
  );
  if (preparedIssue !== null) {
    const checkedResult: MealPlanRuleViolation | null =
      violation(preparedIssue);
    return checkedResult;
  }
  if (approval) {
    const capacityIssue = cookingCapacityIssue(version, request, authority);
    if (capacityIssue !== null) {
      const checkedResult: MealPlanRuleViolation | null =
        violation(capacityIssue);
      return checkedResult;
    }
  }
  {
    const checkedResult: MealPlanRuleViolation | null = null;
    return checkedResult;
  }
};

const missingOutput = (
  reason: "dependent_output_removed" | "unavailable_prepared_food"
) => {
  const checkedResult: MealPlanResolution = {
    _tag: "Gap",
    rationale: "The prepared food for this meal is no longer available.",
    reason,
  };
  return checkedResult;
};

/** Repair downstream prepared meals after a cook event changes or disappears. */
export const repairPreparedDependencies = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority
) => {
  const sources = sourceQuantities(version, authority, request);
  const used = new Map<string, number>();
  const changed: MealPlanRequirementKey[] = [];
  const coverage = version.coverage.map((entry) => {
    if (entry.resolution._tag !== "Prepared") {
      const checkedResult: MealPlanCoverage = entry;
      return checkedResult;
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
      {
        const checkedResult: MealPlanCoverage = {
          ...entry,
          resolution: missingOutput(
            source === undefined
              ? "dependent_output_removed"
              : "unavailable_prepared_food"
          ),
        };
        return checkedResult;
      }
    }
    used.set(outputId, next);
    {
      const checkedResult: MealPlanCoverage = entry;
      return checkedResult;
    }
  });
  {
    const checkedResult: {
      readonly version: MealPlanVersion;
      readonly changed: readonly MealPlanRequirementKey[];
    } = { changed, version: { ...version, coverage } };
    return checkedResult;
  }
};

const pinsFor = (
  authority: PlanningAuthority,
  coverage: readonly MealPlanCoverage[],
  cookEvents: MealPlanVersion["cookEvents"]
) => {
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
  {
    const checkedResult: MealPlanVersion["pins"] = {
      configVersion: authority.content.configVersion,
      content: [...content.values()],
      contentSnapshots: [...content.values()].flatMap((reference) => {
        const option = currentOptionFor(authority.content, reference);
        return option === undefined ? [] : [option];
      }),
      people: authority.people,
      preparedSources,
      routines: [
        ...authority.content.routines.filter(({ state }) => state === "active"),
        ...authority.content.oneOffRoutines,
      ].map(({ id, version }) => ({ routineId: id, routineVersion: version })),
    };
    return checkedResult;
  }
};

export const repinPlanVersion = (
  version: MealPlanVersion,
  authority: PlanningAuthority
) => {
  const checkedResult: MealPlanVersion = {
    ...version,
    pins: pinsFor(authority, version.coverage, version.cookEvents),
  };
  return checkedResult;
};

export const makeInitialPlanVersion = (
  request: MealPlanRequest,
  authority: PlanningAuthority,
  initialCoverage: readonly MealPlanCoverage[] = []
) => {
  const byKey = new Map(
    initialCoverage.map((entry) => [
      requirementIdentity(entry.requirement),
      entry,
    ])
  );
  const eventIds = new Map<string, string>();
  const eventIdFor = (key: string) => {
    const existing = eventIds.get(key);
    if (existing !== undefined) {
      const checkedResult: string = existing;
      return checkedResult;
    }
    const id = `event_${eventIds.size + 1}`;
    eventIds.set(key, id);
    {
      const checkedResult: string = id;
      return checkedResult;
    }
  };
  const plannedOption = (
    requirement: MealPlanRequirementKey,
    optionRef: MealPlanOptionRef,
    eventId: string,
    rationale: string
  ) => {
    const option = currentOptionFor(authority.content, optionRef);
    if (option === undefined) {
      const checkedResult: MealPlanResolution = gap(
        "no_compatible_option",
        "This saved food option is no longer available."
      );
      return checkedResult;
    }
    const preparationIssue = preparationIssueForCoverage(
      authority,
      option,
      requirement
    );
    if (preparationIssue !== null) {
      const checkedResult: MealPlanResolution = gap(
        "preparation_context_unresolved",
        `Review this meal's equipment or preparation window: ${preparationIssue}.`
      );
      return checkedResult;
    }
    {
      const checkedResult: MealPlanResolution = {
        _tag: "MealOption",
        eventId,
        option: optionRef,
        quantity: null,
        rationale,
      };
      return checkedResult;
    }
  };
  const coverage = requiredCoverage(request, authority).map((requirement) => {
    const supplied = byKey.get(requirementIdentity(requirement));
    if (supplied !== undefined) {
      const checkedResult: MealPlanCoverage = supplied;
      return checkedResult;
    }
    const person = personFor(authority.people, requirement.personId);
    if (person === undefined) {
      const checkedResult: MealPlanCoverage = {
        requirement,
        resolution: gap(
          "not_planned",
          "This person needs a saved planning profile."
        ),
      };
      return checkedResult;
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
      const checkedResult: MealPlanCoverage = {
        requirement,
        resolution: gap(
          "routine_conflict",
          "Conflicting routines need an adult choice."
        ),
      };
      return checkedResult;
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
        const checkedResult: MealPlanCoverage = {
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
        return checkedResult;
      }
      {
        const checkedResult: MealPlanCoverage = {
          requirement,
          resolution: gap(
            "unconfirmed_suitability",
            "The routine meal needs suitability review or an approved fallback."
          ),
        };
        return checkedResult;
      }
    }
    if (routine._tag === "NoRoutine") {
      const checkedResult: MealPlanCoverage = {
        requirement,
        resolution: gap(
          "not_planned",
          "No saved routine covers this occasion yet."
        ),
      };
      return checkedResult;
    }
    const rationale = `Applied ${routine.source.scope} routine ${routine.source.id}.`;
    switch (routine.choice._tag) {
      case "Skip": {
        const checkedResult: MealPlanCoverage = {
          requirement,
          resolution: { _tag: "Skip", rationale },
        };
        return checkedResult;
      }
      case "Flexible": {
        const checkedResult: MealPlanCoverage = {
          requirement,
          resolution: { _tag: "Flexible", rationale },
        };
        return checkedResult;
      }
      case "Leftover": {
        const checkedResult: MealPlanCoverage = {
          requirement,
          resolution: gap(
            "unavailable_prepared_food",
            "Choose a confirmed prepared portion for this leftover routine."
          ),
        };
        return checkedResult;
      }
      case "External": {
        const checkedResult: MealPlanCoverage = {
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
        return checkedResult;
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
          const checkedResult: MealPlanCoverage = {
            requirement,
            resolution: gap(
              "no_compatible_option",
              "The routine has no available meal option."
            ),
          };
          return checkedResult;
        }
        {
          const checkedResult: MealPlanCoverage = {
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
          return checkedResult;
        }
      }
      default: {
        const checkedResult: MealPlanCoverage = casesHandled(routine.choice);
        return checkedResult;
      }
    }
  });
  {
    const checkedResult: MealPlanVersion = {
      cookEvents: [],
      coverage,
      number: 1,
      pins: pinsFor(authority, coverage, []),
    };
    return checkedResult;
  }
};

/** Update only a proposed version when authoritative inputs changed. */
export const rebasePlanVersion = (
  version: MealPlanVersion,
  request: MealPlanRequest,
  authority: PlanningAuthority
) => {
  const old = new Map(
    version.coverage.map((entry) => [
      requirementIdentity(entry.requirement),
      entry,
    ])
  );
  const changed: MealPlanRequirementKey[] = [];
  const coverage = requiredCoverage(request, authority).map((requirement) => {
    const prior = old.get(requirementIdentity(requirement));
    if (prior === undefined) {
      changed.push(requirement);
      {
        const checkedResult: MealPlanCoverage = {
          requirement,
          resolution: {
            _tag: "Gap",
            rationale: "This occasion was added after the earlier plan.",
            reason: "not_planned",
          },
        };
        return checkedResult;
      }
    }
    if (prior.resolution._tag !== "MealOption") {
      const checkedResult: MealPlanCoverage = prior;
      return checkedResult;
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
      {
        const checkedResult: MealPlanCoverage = {
          requirement,
          resolution: {
            _tag: "Gap",
            rationale:
              "This meal needs review against the current person and content versions.",
            reason: "unconfirmed_suitability",
          },
        };
        return checkedResult;
      }
    }
    const option = currentOptionFor(authority.content, prior.resolution.option);
    if (
      option === undefined ||
      preparationIssueForCoverage(authority, option, requirement) !== null
    ) {
      changed.push(requirement);
      {
        const checkedResult: MealPlanCoverage = {
          requirement,
          resolution: {
            _tag: "Gap",
            rationale:
              "The saved equipment or preparation window changed; review this meal.",
            reason: "preparation_context_unresolved",
          },
        };
        return checkedResult;
      }
    }
    {
      const checkedResult: MealPlanCoverage = prior;
      return checkedResult;
    }
  });
  const cookEvents = version.cookEvents.filter((cook) => {
    const option = currentOptionFor(authority.content, cook.option);
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
  {
    const checkedResult: {
      readonly version: MealPlanVersion;
      readonly changed: readonly MealPlanRequirementKey[];
    } = {
      changed: [...changed, ...repaired.changed],
      version: repinPlanVersion(repaired.version, authority),
    };
    return checkedResult;
  }
};

export const changePlanVersion = (
  version: MealPlanVersion,
  change: MealPlanChange,
  request: MealPlanRequest,
  authority: PlanningAuthority
) => {
  const changed: MealPlanRequirementKey[] = [];
  let next = version;
  switch (change._tag) {
    case "RefreshInputs": {
      const checkedResult:
        | {
            readonly version: MealPlanVersion;
            readonly changed: readonly MealPlanRequirementKey[];
          }
        | MealPlanRuleViolation = violation("config_version_changed");
      return checkedResult;
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
        const checkedResult:
          | {
              readonly version: MealPlanVersion;
              readonly changed: readonly MealPlanRequirementKey[];
            }
          | MealPlanRuleViolation = violation("requirement_not_found");
        return checkedResult;
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
        const checkedResult:
          | {
              readonly version: MealPlanVersion;
              readonly changed: readonly MealPlanRequirementKey[];
            }
          | MealPlanRuleViolation = violation("requirement_not_found");
        return checkedResult;
      }

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
        const checkedResult:
          | {
              readonly version: MealPlanVersion;
              readonly changed: readonly MealPlanRequirementKey[];
            }
          | MealPlanRuleViolation = violation("cook_event_conflict");
        return checkedResult;
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
      const checkedResult:
        | {
            readonly version: MealPlanVersion;
            readonly changed: readonly MealPlanRequirementKey[];
          }
        | MealPlanRuleViolation = casesHandled(change);
      return checkedResult;
    }
  }
  const repaired = repairPreparedDependencies(next, request, authority);
  const repinned = repinPlanVersion(repaired.version, authority);
  const issue = validatePlanVersion(repinned, request, authority, false);
  if (issue !== null) {
    const checkedResult:
      | {
          readonly version: MealPlanVersion;
          readonly changed: readonly MealPlanRequirementKey[];
        }
      | MealPlanRuleViolation = issue;
    return checkedResult;
  }
  {
    const checkedResult:
      | {
          readonly version: MealPlanVersion;
          readonly changed: readonly MealPlanRequirementKey[];
        }
      | MealPlanRuleViolation = {
      changed: [...changed, ...repaired.changed],
      version: repinned,
    };
    return checkedResult;
  }
};
