import {
  PlanningContentRejected,
  PlanningContentVersion,
} from "@meal-planner/household-api";
import type {
  HouseholdPersonId,
  MealOption,
  Availability,
  CookingCapacity,
  MutatePlanningContentPayload,
  PlanningContentCommand,
  PlanningContentSnapshot,
  PlanningDate,
  PlanningOptionRef,
  ProfileVersion,
  RoutineChoice,
} from "@meal-planner/household-api";

const rejected = (reason: PlanningContentRejected["reason"]) =>
  PlanningContentRejected.make({ reason });
const casesHandled = (value: never): never => {
  throw new Error(`Unexpected planning content variant: ${String(value)}`);
};

export interface PlanningContentAuthority {
  readonly activePersonIds: ReadonlySet<HouseholdPersonId>;
  readonly profileVersions: ReadonlyMap<HouseholdPersonId, ProfileVersion>;
  readonly actorId: string;
  readonly today: PlanningDate;
}

export const emptyPlanningContentSnapshot = (): PlanningContentSnapshot => ({
  availability: [],
  configVersion: PlanningContentVersion.make(0),
  cookingCapacity: {
    availableEquipment: [],
    maximumSubstantialCookEventsPerWeek: 0,
  },
  fallbacks: [],
  managedOccasions: [],
  oneOffRoutines: [],
  options: [],
  preparedPortions: [],
  routines: [],
  suitabilityReviews: [],
});

const sameRef = (left: PlanningOptionRef, right: PlanningOptionRef) =>
  left.kind === right.kind &&
  left.optionId === right.optionId &&
  left.optionVersion === right.optionVersion;

export const currentOptionFor = (
  snapshot: PlanningContentSnapshot,
  reference: PlanningOptionRef
): MealOption | undefined =>
  snapshot.options.find((option) => sameRef(option, reference));

export const currentSuitabilityFor = (
  snapshot: PlanningContentSnapshot,
  personId: HouseholdPersonId,
  profileVersion: ProfileVersion,
  optionRef: PlanningOptionRef
) =>
  snapshot.suitabilityReviews.filter(
    (review) =>
      review.personId === personId &&
      review.profileVersion === profileVersion &&
      sameRef(review.optionRef, optionRef)
  );

/** Unknown or stale human reviews never clear a person's hard constraints. */
export const suitabilityForPlanning = (
  snapshot: PlanningContentSnapshot,
  personId: HouseholdPersonId,
  profileVersion: ProfileVersion,
  optionRef: PlanningOptionRef
): "compatible" | "incompatible" | "unknown" => {
  const reviews = currentSuitabilityFor(
    snapshot,
    personId,
    profileVersion,
    optionRef
  );
  return reviews.length === 1 ? (reviews[0]?.status ?? "unknown") : "unknown";
};

export const contentSuitabilityIssue = (
  snapshot: PlanningContentSnapshot,
  input: {
    readonly personId: HouseholdPersonId;
    readonly profileVersion: ProfileVersion;
    readonly safetyState: "confirmed_none" | "has_constraints" | "unknown";
    readonly optionRef: PlanningOptionRef;
  }
): "unknown_hard_constraints" | "incompatible" | "unreviewed" | null => {
  if (input.safetyState === "unknown") {
    return "unknown_hard_constraints";
  }
  const status = suitabilityForPlanning(
    snapshot,
    input.personId,
    input.profileVersion,
    input.optionRef
  );
  if (status === "incompatible") {
    return "incompatible";
  }
  if (input.safetyState === "has_constraints" && status !== "compatible") {
    return "unreviewed";
  }
  return null;
};

/** Shopping arithmetic only uses quantities a household adult explicitly reviewed. */
export const isShoppingResolved = (option: MealOption): boolean => {
  switch (option.kind) {
    case "recipe": {
      return (
        option.shoppingStatus === "reviewed" &&
        option.yield._tag === "Known" &&
        option.shoppingComponents.length > 0 &&
        option.shoppingComponents.every(
          (component) => component.quantity._tag === "Known"
        )
      );
    }
    case "assembled": {
      return (
        option.yield._tag === "Known" &&
        option.components.every(
          (component) => component.quantity._tag === "Known"
        )
      );
    }
    case "packaged": {
      return option.quantity._tag === "Known";
    }
    case "external": {
      return true;
    }
    default: {
      return casesHandled(option);
    }
  }
};

export const optionPreparationIssue = (
  option: MealOption,
  availability: Availability | undefined,
  capacity: CookingCapacity
):
  | "availability_unknown"
  | "preparation_unknown"
  | "missing_equipment"
  | "preparation_window_conflict"
  | null => {
  if (option.kind === "external") {
    return null;
  }
  if (availability === undefined) {
    return "availability_unknown";
  }
  const { preparation } = option;
  const equipment = new Set(
    capacity.availableEquipment.map((name) => name.toLocaleLowerCase())
  );
  if (
    preparation.requiredEquipment.some(
      (name) => !equipment.has(name.toLocaleLowerCase())
    )
  ) {
    return "missing_equipment";
  }
  if (
    preparation.substantialCookEvent === "unknown" ||
    preparation.startRequirement === "unknown" ||
    preparation.handsOnTime._tag === "Unknown" ||
    preparation.elapsedTime._tag === "Unknown"
  ) {
    return "preparation_unknown";
  }
  if (preparation.handsOnTime.minutes > availability.preparationWindowMinutes) {
    return "preparation_window_conflict";
  }
  if (preparation.startRequirement === "advance_start") {
    return availability.handsOffStart === "available"
      ? null
      : "preparation_window_conflict";
  }
  if (
    preparation.startRequirement === "during_window" &&
    preparation.elapsedTime.minutes > availability.preparationWindowMinutes
  ) {
    return "preparation_window_conflict";
  }
  return null;
};

const refsForChoice = (choice: RoutineChoice): readonly PlanningOptionRef[] => {
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

const putVersioned = <
  T extends { readonly id: string; readonly version: number },
>(
  entries: readonly T[],
  value: T
): readonly T[] | PlanningContentRejected => {
  const current = entries.find((entry) => entry.id === value.id);
  if (value.version !== (current?.version ?? 0) + 1) {
    return rejected("stale_version");
  }
  return [...entries.filter((entry) => entry.id !== value.id), value];
};

const isRejection = (
  value: readonly unknown[] | PlanningContentRejected
): value is PlanningContentRejected => !Array.isArray(value);

const allRefsExist = (
  snapshot: PlanningContentSnapshot,
  refs: readonly PlanningOptionRef[]
) => refs.every((ref) => currentOptionFor(snapshot, ref) !== undefined);

const sameList = <T>(
  left: readonly T[],
  right: readonly T[],
  same: (a: T, b: T) => boolean
): boolean =>
  left.length === right.length &&
  left.every(
    (item, index) => right[index] !== undefined && same(item, right[index])
  );

const sameChoice = (left: RoutineChoice, right: RoutineChoice): boolean => {
  if (left._tag !== right._tag) {
    return false;
  }
  if (left._tag === "Options" && right._tag === "Options") {
    return (
      left.selection === right.selection &&
      sameList(left.optionRefs, right.optionRefs, sameRef)
    );
  }
  if (left._tag === "External" && right._tag === "External") {
    return sameRef(left.optionRef, right.optionRef);
  }
  return true;
};

const managedFor = (
  current: PlanningContentSnapshot,
  authority: PlanningContentAuthority,
  occasionId: string,
  personId?: HouseholdPersonId
): boolean =>
  current.managedOccasions.some(
    (entry) =>
      entry.state === "managed" &&
      entry.occasionId === occasionId &&
      authority.activePersonIds.has(entry.personId) &&
      (personId === undefined || entry.personId === personId)
  );

type Command<Tag extends PlanningContentCommand["_tag"]> = Extract<
  PlanningContentCommand,
  { readonly _tag: Tag }
>;
type Result = PlanningContentSnapshot | PlanningContentRejected;

const setManagedOccasions = (
  current: PlanningContentSnapshot,
  command: Command<"SetManagedOccasions">,
  authority: PlanningContentAuthority
): Result => {
  if (
    command.entries.some(
      (entry) => !authority.activePersonIds.has(entry.personId)
    )
  ) {
    return rejected("missing_person");
  }
  const keys = command.entries.flatMap((entry) =>
    entry.weekdays.map(
      (weekday) => `${entry.personId}:${entry.occasionId}:${weekday}`
    )
  );
  if (new Set(keys).size !== keys.length) {
    return rejected("invalid_transition");
  }
  return { ...current, managedOccasions: command.entries };
};

const setPersonManagedOccasions = (
  current: PlanningContentSnapshot,
  command: Command<"SetPersonManagedOccasions">,
  authority: PlanningContentAuthority
): Result => {
  if (
    !authority.activePersonIds.has(command.personId) ||
    command.entries.some((entry) => entry.personId !== command.personId)
  ) {
    return rejected("missing_person");
  }
  const scoped = setManagedOccasions(
    current,
    {
      _tag: "SetManagedOccasions",
      entries: command.entries,
    },
    authority
  );
  if ("_tag" in scoped) {
    return scoped;
  }
  return {
    ...current,
    managedOccasions: [
      ...current.managedOccasions.filter(
        (entry) => entry.personId !== command.personId
      ),
      ...command.entries,
    ],
  };
};

const setAvailability = (
  current: PlanningContentSnapshot,
  command: Command<"SetAvailability">,
  authority: PlanningContentAuthority
): Result => {
  if (
    command.entries.some(
      (entry) => !authority.activePersonIds.has(entry.personId)
    )
  ) {
    return rejected("missing_person");
  }
  const keys = command.entries.flatMap((entry) =>
    entry.weekdays.map(
      (weekday) => `${entry.personId}:${entry.occasionId}:${weekday}`
    )
  );
  if (new Set(keys).size !== keys.length) {
    return rejected("invalid_transition");
  }
  return { ...current, availability: command.entries };
};

const setPersonAvailability = (
  current: PlanningContentSnapshot,
  command: Command<"SetPersonAvailability">,
  authority: PlanningContentAuthority
): Result => {
  if (
    !authority.activePersonIds.has(command.personId) ||
    command.entries.some((entry) => entry.personId !== command.personId)
  ) {
    return rejected("missing_person");
  }
  const scoped = setAvailability(
    current,
    {
      _tag: "SetAvailability",
      entries: command.entries,
    },
    authority
  );
  if ("_tag" in scoped) {
    return scoped;
  }
  return {
    ...current,
    availability: [
      ...current.availability.filter(
        (entry) => entry.personId !== command.personId
      ),
      ...command.entries,
    ],
  };
};

const putRoutine = (
  current: PlanningContentSnapshot,
  command: Command<"PutRoutine">,
  authority: PlanningContentAuthority
): Result => {
  const { value } = command;
  const previous = current.routines.find((entry) => entry.id === value.id);
  if (value.state === "paused") {
    if (
      !previous ||
      previous.occasionId !== value.occasionId ||
      previous.scope._tag !== value.scope._tag ||
      (previous.scope._tag === "Person" &&
        value.scope._tag === "Person" &&
        previous.scope.personId !== value.scope.personId) ||
      !sameChoice(previous.choice, value.choice) ||
      !sameList(previous.weekdays, value.weekdays, (a, b) => a === b)
    ) {
      return rejected("invalid_transition");
    }
    const routines = putVersioned(current.routines, value);
    return isRejection(routines) ? routines : { ...current, routines };
  }
  if (
    value.scope._tag === "Person" &&
    !authority.activePersonIds.has(value.scope.personId)
  ) {
    return rejected("missing_person");
  }
  if (
    !managedFor(
      current,
      authority,
      value.occasionId,
      value.scope._tag === "Person" ? value.scope.personId : undefined
    )
  ) {
    return rejected("invalid_transition");
  }
  if (!allRefsExist(current, refsForChoice(value.choice))) {
    return rejected("stale_option");
  }
  const routines = putVersioned(current.routines, value);
  return isRejection(routines) ? routines : { ...current, routines };
};

const putOneOffRoutine = (
  current: PlanningContentSnapshot,
  command: Command<"PutOneOffRoutine">,
  authority: PlanningContentAuthority
): Result => {
  if (!authority.activePersonIds.has(command.value.personId)) {
    return rejected("missing_person");
  }
  if (!allRefsExist(current, refsForChoice(command.value.choice))) {
    return rejected("stale_option");
  }
  const oneOffRoutines = putVersioned(current.oneOffRoutines, command.value);
  return isRejection(oneOffRoutines)
    ? oneOffRoutines
    : { ...current, oneOffRoutines };
};

const putFallback = (
  current: PlanningContentSnapshot,
  command: Command<"PutFallback">,
  authority: PlanningContentAuthority
): Result => {
  const { value } = command;
  const previous = current.fallbacks.find((entry) => entry.id === value.id);
  if (value.state !== "active") {
    if (
      !previous ||
      previous.personId !== value.personId ||
      previous.priority !== value.priority ||
      previous.substitutionPolicy !== value.substitutionPolicy ||
      !sameRef(previous.optionRef, value.optionRef) ||
      !sameList(previous.locations, value.locations, (a, b) => a === b) ||
      !sameList(previous.occasionIds, value.occasionIds, (a, b) => a === b)
    ) {
      return rejected("invalid_transition");
    }
    const fallbacks = putVersioned(current.fallbacks, value);
    return isRejection(fallbacks) ? fallbacks : { ...current, fallbacks };
  }
  if (!authority.activePersonIds.has(value.personId)) {
    return rejected("missing_person");
  }
  if (
    !current.managedOccasions.some(
      (entry) =>
        entry.state === "managed" &&
        entry.personId === value.personId &&
        (value.occasionIds.length === 0 ||
          value.occasionIds.includes(entry.occasionId))
    ) ||
    value.occasionIds.some(
      (occasionId) =>
        !managedFor(current, authority, occasionId, value.personId)
    )
  ) {
    return rejected("invalid_transition");
  }
  if (!currentOptionFor(current, value.optionRef)) {
    return rejected("stale_option");
  }
  const fallbacks = putVersioned(current.fallbacks, value);
  return isRejection(fallbacks) ? fallbacks : { ...current, fallbacks };
};

const putOption = (
  current: PlanningContentSnapshot,
  command: Command<"PutOption">
): Result => {
  const option = command.value;
  if (
    option.kind === "recipe" &&
    option.shoppingStatus === "reviewed" &&
    !isShoppingResolved(option)
  ) {
    return rejected("invalid_transition");
  }
  const previous = current.options.find(
    (entry) => entry.optionId === option.optionId
  );
  if (previous && previous.kind !== option.kind) {
    return rejected("invalid_transition");
  }
  if (option.optionVersion !== (previous?.optionVersion ?? 0) + 1) {
    return rejected("stale_version");
  }
  return {
    ...current,
    options: [
      ...current.options.filter((entry) => entry.optionId !== option.optionId),
      option,
    ],
  };
};

const putSuitabilityReview = (
  current: PlanningContentSnapshot,
  command: Command<"PutSuitabilityReview">,
  authority: PlanningContentAuthority
): Result => {
  const review = command.value;
  if (!authority.activePersonIds.has(review.personId)) {
    return rejected("missing_person");
  }
  if (
    authority.profileVersions.get(review.personId) !== review.profileVersion
  ) {
    return rejected("stale_profile");
  }
  if (!currentOptionFor(current, review.optionRef)) {
    return rejected("stale_option");
  }
  if (
    currentSuitabilityFor(
      current,
      review.personId,
      review.profileVersion,
      review.optionRef
    ).some((prior) => prior.id !== review.id)
  ) {
    return rejected("invalid_transition");
  }
  const { confirmation: _confirmation, ...reviewFacts } = review;
  const suitabilityReviews = putVersioned(current.suitabilityReviews, {
    ...reviewFacts,
    confirmedByActorId: authority.actorId,
  });
  return isRejection(suitabilityReviews)
    ? suitabilityReviews
    : { ...current, suitabilityReviews };
};

const putPreparedPortion = (
  current: PlanningContentSnapshot,
  command: Command<"PutPreparedPortion">
): Result => {
  const write = command.value;
  if (
    write.sourceOptionRef !== null &&
    !currentOptionFor(current, write.sourceOptionRef)
  ) {
    return rejected("stale_option");
  }
  const previous = current.preparedPortions.find(
    (item) => item.id === write.id
  );
  const reservations = previous?.reservations ?? [];
  const reserved = reservations.reduce((sum, entry) => sum + entry.amount, 0);
  if (
    reserved > write.remainingAmount ||
    write.remainingAmount > write.quantity.amount
  ) {
    return rejected("quantity_exceeded");
  }
  if (
    reservations.length > 0 &&
    (write.state !== "available" ||
      write.confirmedForWeekStart !== previous?.confirmedForWeekStart ||
      JSON.stringify(write.sourceOptionRef) !==
        JSON.stringify(previous?.sourceOptionRef))
  ) {
    return rejected("invalid_transition");
  }
  if (
    previous &&
    (previous.quantity.unit !== write.quantity.unit ||
      previous.sourceCookEventId !== write.sourceCookEventId)
  ) {
    return rejected("invalid_transition");
  }
  const { reason, ...fields } = write;
  const portion = {
    ...fields,
    lastCorrectionReason: reason,
    reservations,
    state: reservations.length > 0 ? ("reserved" as const) : write.state,
  };
  const preparedPortions = putVersioned(current.preparedPortions, portion);
  return isRejection(preparedPortions)
    ? preparedPortions
    : { ...current, preparedPortions };
};

const confirmPreparedCarryOver = (
  current: PlanningContentSnapshot,
  command: Command<"ConfirmPreparedCarryOver">,
  authority: PlanningContentAuthority
): Result => {
  const confirmation = command.value;
  const portion = current.preparedPortions.find(
    (item) => item.id === confirmation.id
  );
  if (!portion) {
    return rejected("invalid_transition");
  }
  if (portion.version !== confirmation.expectedPortionVersion) {
    return rejected("stale_version");
  }
  if (
    confirmation.confirmedForWeekStart > authority.today ||
    portion.confirmedForWeekStart === null ||
    confirmation.confirmedForWeekStart <= portion.confirmedForWeekStart ||
    portion.reservations.some(
      (reservation) => reservation.date >= authority.today
    )
  ) {
    return rejected("invalid_transition");
  }
  if (confirmation.remainingAmount > portion.quantity.amount) {
    return rejected("quantity_exceeded");
  }
  const updated = {
    ...portion,
    confirmedForWeekStart: confirmation.confirmedForWeekStart,
    lastCorrectionReason: confirmation.reason,
    remainingAmount: confirmation.remainingAmount,
    reservations: [],
    state:
      confirmation.remainingAmount > 0
        ? ("available" as const)
        : ("consumed" as const),
    version: portion.version + 1,
  };
  return {
    ...current,
    preparedPortions: current.preparedPortions.map((item) =>
      item.id === portion.id ? updated : item
    ),
  };
};

/** Pure, version-guarded change. The adapter supplies current people/profile authority. */
export const applyPlanningContentCommand = (
  current: PlanningContentSnapshot,
  payload: MutatePlanningContentPayload,
  authority: PlanningContentAuthority
): PlanningContentSnapshot | PlanningContentRejected => {
  if (current.configVersion !== payload.expectedVersion) {
    return rejected("stale_version");
  }
  const { command } = payload;
  let next: Result;
  switch (command._tag) {
    case "SetManagedOccasions": {
      next = setManagedOccasions(current, command, authority);
      break;
    }
    case "SetPersonManagedOccasions": {
      next = setPersonManagedOccasions(current, command, authority);
      break;
    }
    case "SetAvailability": {
      next = setAvailability(current, command, authority);
      break;
    }
    case "SetPersonAvailability": {
      next = setPersonAvailability(current, command, authority);
      break;
    }
    case "SetCookingCapacity": {
      next = { ...current, cookingCapacity: command.value };
      break;
    }
    case "PutRoutine": {
      next = putRoutine(current, command, authority);
      break;
    }
    case "PutOneOffRoutine": {
      next = putOneOffRoutine(current, command, authority);
      break;
    }
    case "PutFallback": {
      next = putFallback(current, command, authority);
      break;
    }
    case "PutOption": {
      next = putOption(current, command);
      break;
    }
    case "PutSuitabilityReview": {
      next = putSuitabilityReview(current, command, authority);
      break;
    }
    case "PutPreparedPortion": {
      next = putPreparedPortion(current, command);
      break;
    }
    case "ConfirmPreparedCarryOver": {
      next = confirmPreparedCarryOver(current, command, authority);
      break;
    }
    default: {
      return casesHandled(command);
    }
  }
  if ("_tag" in next) {
    return next;
  }
  return {
    ...next,
    configVersion: PlanningContentVersion.make(current.configVersion + 1),
  };
};
