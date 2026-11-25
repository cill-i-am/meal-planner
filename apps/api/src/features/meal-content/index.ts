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

export const emptyPlanningContentSnapshot = () => {
  const checkedResult: PlanningContentSnapshot = {
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
  };
  return checkedResult;
};

const sameRef = (left: PlanningOptionRef, right: PlanningOptionRef) =>
  left.kind === right.kind &&
  left.optionId === right.optionId &&
  left.optionVersion === right.optionVersion;

export const currentOptionFor = (
  snapshot: PlanningContentSnapshot,
  reference: PlanningOptionRef
) => {
  const checkedResult: MealOption | undefined = snapshot.options.find(
    (option) => sameRef(option, reference)
  );
  return checkedResult;
};

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
) => {
  const reviews = currentSuitabilityFor(
    snapshot,
    personId,
    profileVersion,
    optionRef
  );
  {
    const checkedResult: "compatible" | "incompatible" | "unknown" =
      reviews.length === 1 ? (reviews[0]?.status ?? "unknown") : "unknown";
    return checkedResult;
  }
};

export const contentSuitabilityIssue = (
  snapshot: PlanningContentSnapshot,
  input: {
    readonly personId: HouseholdPersonId;
    readonly profileVersion: ProfileVersion;
    readonly safetyState: "confirmed_none" | "has_constraints" | "unknown";
    readonly optionRef: PlanningOptionRef;
  }
) => {
  if (input.safetyState === "unknown") {
    const checkedResult:
      | "unknown_hard_constraints"
      | "incompatible"
      | "unreviewed"
      | null = "unknown_hard_constraints";
    return checkedResult;
  }
  const status = suitabilityForPlanning(
    snapshot,
    input.personId,
    input.profileVersion,
    input.optionRef
  );
  if (status === "incompatible") {
    const checkedResult:
      | "unknown_hard_constraints"
      | "incompatible"
      | "unreviewed"
      | null = "incompatible";
    return checkedResult;
  }
  if (input.safetyState === "has_constraints" && status !== "compatible") {
    const checkedResult:
      | "unknown_hard_constraints"
      | "incompatible"
      | "unreviewed"
      | null = "unreviewed";
    return checkedResult;
  }
  {
    const checkedResult:
      | "unknown_hard_constraints"
      | "incompatible"
      | "unreviewed"
      | null = null;
    return checkedResult;
  }
};

/** Shopping arithmetic only uses quantities a household adult explicitly reviewed. */
export const isShoppingResolved = (option: MealOption) => {
  switch (option.kind) {
    case "recipe": {
      const checkedResult: boolean =
        option.shoppingStatus === "reviewed" &&
        option.yield._tag === "Known" &&
        option.shoppingComponents.length > 0 &&
        option.shoppingComponents.every(
          (component) => component.quantity._tag === "Known"
        );
      return checkedResult;
    }
    case "assembled": {
      const checkedResult: boolean =
        option.yield._tag === "Known" &&
        option.components.every(
          (component) => component.quantity._tag === "Known"
        );
      return checkedResult;
    }
    case "packaged": {
      const checkedResult: boolean = option.quantity._tag === "Known";
      return checkedResult;
    }
    case "external": {
      const checkedResult = true;
      return checkedResult;
    }
    default: {
      const checkedResult: boolean = casesHandled(option);
      return checkedResult;
    }
  }
};

export const optionPreparationIssue = (
  option: MealOption,
  availability: Availability | undefined,
  capacity: CookingCapacity
) => {
  if (option.kind === "external") {
    const checkedResult:
      | "availability_unknown"
      | "preparation_unknown"
      | "missing_equipment"
      | "preparation_window_conflict"
      | null = null;
    return checkedResult;
  }
  if (availability === undefined) {
    const checkedResult:
      | "availability_unknown"
      | "preparation_unknown"
      | "missing_equipment"
      | "preparation_window_conflict"
      | null = "availability_unknown";
    return checkedResult;
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
    const checkedResult:
      | "availability_unknown"
      | "preparation_unknown"
      | "missing_equipment"
      | "preparation_window_conflict"
      | null = "missing_equipment";
    return checkedResult;
  }
  if (
    preparation.substantialCookEvent === "unknown" ||
    preparation.startRequirement === "unknown" ||
    preparation.handsOnTime._tag === "Unknown" ||
    preparation.elapsedTime._tag === "Unknown"
  ) {
    const checkedResult:
      | "availability_unknown"
      | "preparation_unknown"
      | "missing_equipment"
      | "preparation_window_conflict"
      | null = "preparation_unknown";
    return checkedResult;
  }
  if (preparation.handsOnTime.minutes > availability.preparationWindowMinutes) {
    const checkedResult:
      | "availability_unknown"
      | "preparation_unknown"
      | "missing_equipment"
      | "preparation_window_conflict"
      | null = "preparation_window_conflict";
    return checkedResult;
  }
  if (preparation.startRequirement === "advance_start") {
    const checkedResult:
      | "availability_unknown"
      | "preparation_unknown"
      | "missing_equipment"
      | "preparation_window_conflict"
      | null =
      availability.handsOffStart === "available"
        ? null
        : "preparation_window_conflict";
    return checkedResult;
  }
  if (
    preparation.startRequirement === "during_window" &&
    preparation.elapsedTime.minutes > availability.preparationWindowMinutes
  ) {
    const checkedResult:
      | "availability_unknown"
      | "preparation_unknown"
      | "missing_equipment"
      | "preparation_window_conflict"
      | null = "preparation_window_conflict";
    return checkedResult;
  }
  {
    const checkedResult:
      | "availability_unknown"
      | "preparation_unknown"
      | "missing_equipment"
      | "preparation_window_conflict"
      | null = null;
    return checkedResult;
  }
};

const refsForChoice = (choice: RoutineChoice) => {
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

const putVersioned = <
  T extends { readonly id: string; readonly version: number },
>(
  entries: readonly T[],
  value: T
) => {
  const current = entries.find((entry) => entry.id === value.id);
  if (value.version !== (current?.version ?? 0) + 1) {
    const checkedResult: readonly T[] | PlanningContentRejected =
      rejected("stale_version");
    return checkedResult;
  }
  {
    const checkedResult: readonly T[] | PlanningContentRejected = [
      ...entries.filter((entry) => entry.id !== value.id),
      value,
    ];
    return checkedResult;
  }
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
) => {
  const checkedResult: boolean =
    left.length === right.length &&
    left.every(
      (item, index) => right[index] !== undefined && same(item, right[index])
    );
  return checkedResult;
};

const sameChoice = (left: RoutineChoice, right: RoutineChoice) => {
  if (left._tag !== right._tag) {
    const checkedResult = false;
    return checkedResult;
  }
  if (left._tag === "Options" && right._tag === "Options") {
    const checkedResult: boolean =
      left.selection === right.selection &&
      sameList(left.optionRefs, right.optionRefs, sameRef);
    return checkedResult;
  }
  if (left._tag === "External" && right._tag === "External") {
    const checkedResult: boolean = sameRef(left.optionRef, right.optionRef);
    return checkedResult;
  }
  {
    const checkedResult = true;
    return checkedResult;
  }
};

const managedFor = (
  current: PlanningContentSnapshot,
  authority: PlanningContentAuthority,
  occasionId: string,
  personId?: HouseholdPersonId
) => {
  const checkedResult: boolean = current.managedOccasions.some(
    (entry) =>
      entry.state === "managed" &&
      entry.occasionId === occasionId &&
      authority.activePersonIds.has(entry.personId) &&
      (personId === undefined || entry.personId === personId)
  );
  return checkedResult;
};

type Command<Tag extends PlanningContentCommand["_tag"]> = Extract<
  PlanningContentCommand,
  { readonly _tag: Tag }
>;
type Result = PlanningContentSnapshot | PlanningContentRejected;

const setManagedOccasions = (
  current: PlanningContentSnapshot,
  command: Command<"SetManagedOccasions">,
  authority: PlanningContentAuthority
) => {
  if (
    command.entries.some(
      (entry) => !authority.activePersonIds.has(entry.personId)
    )
  ) {
    const checkedResult: Result = rejected("missing_person");
    return checkedResult;
  }
  const keys = command.entries.flatMap((entry) =>
    entry.weekdays.map(
      (weekday) => `${entry.personId}:${entry.occasionId}:${weekday}`
    )
  );
  if (new Set(keys).size !== keys.length) {
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  {
    const checkedResult: Result = {
      ...current,
      managedOccasions: command.entries,
    };
    return checkedResult;
  }
};

const setPersonManagedOccasions = (
  current: PlanningContentSnapshot,
  command: Command<"SetPersonManagedOccasions">,
  authority: PlanningContentAuthority
) => {
  if (
    !authority.activePersonIds.has(command.personId) ||
    command.entries.some((entry) => entry.personId !== command.personId)
  ) {
    const checkedResult: Result = rejected("missing_person");
    return checkedResult;
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
    const checkedResult: Result = scoped;
    return checkedResult;
  }
  {
    const checkedResult: Result = {
      ...current,
      managedOccasions: [
        ...current.managedOccasions.filter(
          (entry) => entry.personId !== command.personId
        ),
        ...command.entries,
      ],
    };
    return checkedResult;
  }
};

const setAvailability = (
  current: PlanningContentSnapshot,
  command: Command<"SetAvailability">,
  authority: PlanningContentAuthority
) => {
  if (
    command.entries.some(
      (entry) => !authority.activePersonIds.has(entry.personId)
    )
  ) {
    const checkedResult: Result = rejected("missing_person");
    return checkedResult;
  }
  const keys = command.entries.flatMap((entry) =>
    entry.weekdays.map(
      (weekday) => `${entry.personId}:${entry.occasionId}:${weekday}`
    )
  );
  if (new Set(keys).size !== keys.length) {
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  {
    const checkedResult: Result = { ...current, availability: command.entries };
    return checkedResult;
  }
};

const setPersonAvailability = (
  current: PlanningContentSnapshot,
  command: Command<"SetPersonAvailability">,
  authority: PlanningContentAuthority
) => {
  if (
    !authority.activePersonIds.has(command.personId) ||
    command.entries.some((entry) => entry.personId !== command.personId)
  ) {
    const checkedResult: Result = rejected("missing_person");
    return checkedResult;
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
    const checkedResult: Result = scoped;
    return checkedResult;
  }
  {
    const checkedResult: Result = {
      ...current,
      availability: [
        ...current.availability.filter(
          (entry) => entry.personId !== command.personId
        ),
        ...command.entries,
      ],
    };
    return checkedResult;
  }
};

const putRoutine = (
  current: PlanningContentSnapshot,
  command: Command<"PutRoutine">,
  authority: PlanningContentAuthority
) => {
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
      const checkedResult: Result = rejected("invalid_transition");
      return checkedResult;
    }
    const routines = putVersioned(current.routines, value);
    {
      const checkedResult: Result = isRejection(routines)
        ? routines
        : { ...current, routines };
      return checkedResult;
    }
  }
  if (
    value.scope._tag === "Person" &&
    !authority.activePersonIds.has(value.scope.personId)
  ) {
    const checkedResult: Result = rejected("missing_person");
    return checkedResult;
  }
  if (
    !managedFor(
      current,
      authority,
      value.occasionId,
      value.scope._tag === "Person" ? value.scope.personId : undefined
    )
  ) {
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  if (!allRefsExist(current, refsForChoice(value.choice))) {
    const checkedResult: Result = rejected("stale_option");
    return checkedResult;
  }
  const routines = putVersioned(current.routines, value);
  {
    const checkedResult: Result = isRejection(routines)
      ? routines
      : { ...current, routines };
    return checkedResult;
  }
};

const putOneOffRoutine = (
  current: PlanningContentSnapshot,
  command: Command<"PutOneOffRoutine">,
  authority: PlanningContentAuthority
) => {
  if (!authority.activePersonIds.has(command.value.personId)) {
    const checkedResult: Result = rejected("missing_person");
    return checkedResult;
  }
  if (!allRefsExist(current, refsForChoice(command.value.choice))) {
    const checkedResult: Result = rejected("stale_option");
    return checkedResult;
  }
  const oneOffRoutines = putVersioned(current.oneOffRoutines, command.value);
  {
    const checkedResult: Result = isRejection(oneOffRoutines)
      ? oneOffRoutines
      : { ...current, oneOffRoutines };
    return checkedResult;
  }
};

const putFallback = (
  current: PlanningContentSnapshot,
  command: Command<"PutFallback">,
  authority: PlanningContentAuthority
) => {
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
      const checkedResult: Result = rejected("invalid_transition");
      return checkedResult;
    }
    const fallbacks = putVersioned(current.fallbacks, value);
    {
      const checkedResult: Result = isRejection(fallbacks)
        ? fallbacks
        : { ...current, fallbacks };
      return checkedResult;
    }
  }
  if (!authority.activePersonIds.has(value.personId)) {
    const checkedResult: Result = rejected("missing_person");
    return checkedResult;
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
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  if (!currentOptionFor(current, value.optionRef)) {
    const checkedResult: Result = rejected("stale_option");
    return checkedResult;
  }
  const fallbacks = putVersioned(current.fallbacks, value);
  {
    const checkedResult: Result = isRejection(fallbacks)
      ? fallbacks
      : { ...current, fallbacks };
    return checkedResult;
  }
};

const putOption = (
  current: PlanningContentSnapshot,
  command: Command<"PutOption">
) => {
  const option = command.value;
  if (
    option.kind === "recipe" &&
    option.shoppingStatus === "reviewed" &&
    !isShoppingResolved(option)
  ) {
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  const previous = current.options.find(
    (entry) => entry.optionId === option.optionId
  );
  if (previous && previous.kind !== option.kind) {
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  if (option.optionVersion !== (previous?.optionVersion ?? 0) + 1) {
    const checkedResult: Result = rejected("stale_version");
    return checkedResult;
  }
  {
    const checkedResult: Result = {
      ...current,
      options: [
        ...current.options.filter(
          (entry) => entry.optionId !== option.optionId
        ),
        option,
      ],
    };
    return checkedResult;
  }
};

const putSuitabilityReview = (
  current: PlanningContentSnapshot,
  command: Command<"PutSuitabilityReview">,
  authority: PlanningContentAuthority
) => {
  const review = command.value;
  if (!authority.activePersonIds.has(review.personId)) {
    const checkedResult: Result = rejected("missing_person");
    return checkedResult;
  }
  if (
    authority.profileVersions.get(review.personId) !== review.profileVersion
  ) {
    const checkedResult: Result = rejected("stale_profile");
    return checkedResult;
  }
  if (!currentOptionFor(current, review.optionRef)) {
    const checkedResult: Result = rejected("stale_option");
    return checkedResult;
  }
  if (
    currentSuitabilityFor(
      current,
      review.personId,
      review.profileVersion,
      review.optionRef
    ).some((prior) => prior.id !== review.id)
  ) {
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  const { confirmation: _confirmation, ...reviewFacts } = review;
  const suitabilityReviews = putVersioned(current.suitabilityReviews, {
    ...reviewFacts,
    confirmedByActorId: authority.actorId,
  });
  {
    const checkedResult: Result = isRejection(suitabilityReviews)
      ? suitabilityReviews
      : { ...current, suitabilityReviews };
    return checkedResult;
  }
};

const putPreparedPortion = (
  current: PlanningContentSnapshot,
  command: Command<"PutPreparedPortion">
) => {
  const write = command.value;
  if (
    write.sourceOptionRef !== null &&
    !currentOptionFor(current, write.sourceOptionRef)
  ) {
    const checkedResult: Result = rejected("stale_option");
    return checkedResult;
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
    const checkedResult: Result = rejected("quantity_exceeded");
    return checkedResult;
  }
  if (
    reservations.length > 0 &&
    (write.state !== "available" ||
      write.confirmedForWeekStart !== previous?.confirmedForWeekStart ||
      JSON.stringify(write.sourceOptionRef) !==
        JSON.stringify(previous?.sourceOptionRef))
  ) {
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  if (
    previous &&
    (previous.quantity.unit !== write.quantity.unit ||
      previous.sourceCookEventId !== write.sourceCookEventId)
  ) {
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  const { reason, ...fields } = write;
  const portion = {
    ...fields,
    lastCorrectionReason: reason,
    reservations,
    state: reservations.length > 0 ? ("reserved" as const) : write.state,
  };
  const preparedPortions = putVersioned(current.preparedPortions, portion);
  {
    const checkedResult: Result = isRejection(preparedPortions)
      ? preparedPortions
      : { ...current, preparedPortions };
    return checkedResult;
  }
};

const confirmPreparedCarryOver = (
  current: PlanningContentSnapshot,
  command: Command<"ConfirmPreparedCarryOver">,
  authority: PlanningContentAuthority
) => {
  const confirmation = command.value;
  const portion = current.preparedPortions.find(
    (item) => item.id === confirmation.id
  );
  if (!portion) {
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  if (portion.version !== confirmation.expectedPortionVersion) {
    const checkedResult: Result = rejected("stale_version");
    return checkedResult;
  }
  if (
    confirmation.confirmedForWeekStart > authority.today ||
    portion.confirmedForWeekStart === null ||
    confirmation.confirmedForWeekStart <= portion.confirmedForWeekStart ||
    portion.reservations.some(
      (reservation) => reservation.date >= authority.today
    )
  ) {
    const checkedResult: Result = rejected("invalid_transition");
    return checkedResult;
  }
  if (confirmation.remainingAmount > portion.quantity.amount) {
    const checkedResult: Result = rejected("quantity_exceeded");
    return checkedResult;
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
  {
    const checkedResult: Result = {
      ...current,
      preparedPortions: current.preparedPortions.map((item) =>
        item.id === portion.id ? updated : item
      ),
    };
    return checkedResult;
  }
};

/** Pure, version-guarded change. The adapter supplies current people/profile authority. */
export const applyPlanningContentCommand = (
  current: PlanningContentSnapshot,
  payload: MutatePlanningContentPayload,
  authority: PlanningContentAuthority
) => {
  if (current.configVersion !== payload.expectedVersion) {
    const checkedResult: PlanningContentSnapshot | PlanningContentRejected =
      rejected("stale_version");
    return checkedResult;
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
      const checkedResult: PlanningContentSnapshot | PlanningContentRejected =
        casesHandled(command);
      return checkedResult;
    }
  }
  if ("_tag" in next) {
    const checkedResult: PlanningContentSnapshot | PlanningContentRejected =
      next;
    return checkedResult;
  }
  {
    const checkedResult: PlanningContentSnapshot | PlanningContentRejected = {
      ...next,
      configVersion: PlanningContentVersion.make(current.configVersion + 1),
    };
    return checkedResult;
  }
};
