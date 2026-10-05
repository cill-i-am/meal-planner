import type {
  MealPlanCoverage,
  MealPlanResolution,
  MealPlanVersion,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";

export const coverageKey = (coverage: MealPlanCoverage) =>
  `${coverage.requirement.date}:${coverage.requirement.occasion}:${coverage.requirement.personId}`;

export const coverageChanges = (
  active: MealPlanVersion,
  proposed: MealPlanVersion
) => {
  const prior = new Map(
    active.coverage.map((entry) => [coverageKey(entry), entry.resolution])
  );
  return proposed.coverage.filter((entry) => {
    const before = prior.get(coverageKey(entry));
    return (
      before === undefined ||
      JSON.stringify(before) !== JSON.stringify(entry.resolution)
    );
  });
};

export const resolutionLabel = (
  resolution: MealPlanResolution,
  snapshot: PlanningContentSnapshot,
  cookEvents: MealPlanVersion["cookEvents"] = []
): string => {
  switch (resolution._tag) {
    case "MealOption": {
      return (
        snapshot.options.find(
          (option) =>
            option.optionId === resolution.option.optionId &&
            option.optionVersion === resolution.option.optionVersion
        )?.label ?? "Saved meal unavailable"
      );
    }
    case "Prepared": {
      const stock = snapshot.preparedPortions.find(
        (portion) => portion.id === resolution.outputId
      );
      if (stock) {
        return stock.label;
      }
      const cook = cookEvents.find((event) =>
        event.outputs.some((output) => output.outputId === resolution.outputId)
      );
      if (!cook) {
        return "Prepared food source unavailable";
      }
      const source = snapshot.options.find(
        (option) =>
          option.optionId === cook.option.optionId &&
          option.optionVersion === cook.option.optionVersion
      );
      return source
        ? `${source.label} leftovers`
        : "Prepared food source unavailable";
    }
    case "External": {
      return resolution.description;
    }
    case "Skip": {
      return "Intentionally skipped";
    }
    case "Flexible": {
      return "Decide on the day";
    }
    case "Gap": {
      return "Needs a meal";
    }
    default: {
      return "Meal needs review";
    }
  }
};

export const approvalBlockers = (
  version: MealPlanVersion,
  snapshot: PlanningContentSnapshot,
  weekStart: string
) => {
  const gaps = version.coverage.filter(
    (entry) => entry.resolution._tag === "Gap"
  );
  const unresolvedAmounts = version.coverage.filter((entry) => {
    if (entry.resolution._tag !== "MealOption") {
      return false;
    }
    const { resolution } = entry;
    if (resolution.option.kind === "external") {
      return false;
    }
    if (resolution.quantity === null) {
      return true;
    }
    const option = snapshot.options.find(
      (item) =>
        item.optionId === resolution.option.optionId &&
        item.optionVersion === resolution.option.optionVersion
    );
    if (option?.kind === "recipe") {
      return (
        option.yield._tag === "Unresolved" ||
        option.shoppingStatus === "unresolved"
      );
    }
    if (option?.kind === "assembled") {
      return (
        option.yield._tag === "Unresolved" ||
        option.components.some(
          (component) => component.quantity._tag === "Unresolved"
        )
      );
    }
    return option?.kind === "packaged" && option.quantity._tag === "Unresolved";
  });
  const unconfirmedCarryOver = version.coverage.filter((entry) => {
    if (entry.resolution._tag !== "Prepared") {
      return false;
    }
    const { outputId } = entry.resolution;
    const portion = snapshot.preparedPortions.find(
      (item) => item.id === outputId
    );
    const days = Math.floor(
      (Date.parse(`${entry.requirement.date}T00:00:00Z`) -
        Date.parse(`${weekStart}T00:00:00Z`)) /
        86_400_000
    );
    const week = new Date(`${weekStart}T00:00:00Z`);
    week.setUTCDate(week.getUTCDate() + Math.floor(days / 7) * 7);
    const cook = version.cookEvents.find((event) =>
      event.outputs.some((output) => output.outputId === outputId)
    );
    if (cook) {
      return (
        entry.requirement.date < cook.date ||
        Math.floor(
          (Date.parse(`${cook.date}T00:00:00Z`) -
            Date.parse(`${weekStart}T00:00:00Z`)) /
            86_400_000 /
            7
        ) !== Math.floor(days / 7)
      );
    }
    return portion?.confirmedForWeekStart !== week.toISOString().slice(0, 10);
  });
  const suitabilityStatus = (entry: MealPlanCoverage) => {
    const { resolution } = entry;
    let optionRef = null;
    if (resolution._tag === "MealOption") {
      optionRef = resolution.option;
    }
    if (resolution._tag === "Prepared") {
      optionRef =
        version.pins.preparedSources.find(
          (item) => item.outputId === resolution.outputId
        )?.optionRef ?? null;
    }
    if (resolution._tag !== "MealOption" && resolution._tag !== "Prepared") {
      return "none" as const;
    }
    if (!optionRef) {
      return "unreviewed" as const;
    }
    const person = version.pins.people.find(
      (pin) => pin.personId === entry.requirement.personId
    );
    if (!person || person.safetyState === "unknown") {
      return "unreviewed" as const;
    }
    const review = snapshot.suitabilityReviews.find(
      (item) =>
        item.personId === entry.requirement.personId &&
        item.profileVersion === person.profileVersion &&
        item.optionRef.optionId === optionRef.optionId &&
        item.optionRef.optionVersion === optionRef.optionVersion
    );
    if (review?.status === "incompatible") {
      return "incompatible" as const;
    }
    if (
      person.safetyState === "has_constraints" &&
      review?.status !== "compatible"
    ) {
      return "unreviewed" as const;
    }
    return "none" as const;
  };
  const unreviewedSuitability = version.coverage.filter(
    (entry) => suitabilityStatus(entry) === "unreviewed"
  );
  const incompatibleSuitability = version.coverage.filter(
    (entry) => suitabilityStatus(entry) === "incompatible"
  );
  const unknownSafety = version.pins.people.filter(
    (pin) => pin.safetyState === "unknown"
  );
  const preparedTotals = new Map<string, number>();
  for (const entry of version.coverage) {
    if (entry.resolution._tag === "Prepared") {
      preparedTotals.set(
        entry.resolution.outputId,
        (preparedTotals.get(entry.resolution.outputId) ?? 0) +
          entry.resolution.quantity.amount
      );
    }
  }
  const overallocatedPrepared = [...preparedTotals].filter(
    ([outputId, amount]) => {
      const output = version.cookEvents
        .flatMap((event) => event.outputs)
        .find((item) => item.outputId === outputId);
      if (output) {
        return amount > output.quantity.amount;
      }
      const portion = snapshot.preparedPortions.find(
        (item) => item.id === outputId
      );
      return !portion || amount > portion.remainingAmount;
    }
  );
  const preparationUnknown = version.coverage.filter((entry) => {
    if (
      entry.resolution._tag !== "MealOption" ||
      entry.resolution.option.kind === "external"
    ) {
      return false;
    }
    const { resolution } = entry;
    const option = snapshot.options.find(
      (item) =>
        item.optionId === resolution.option.optionId &&
        item.optionVersion === resolution.option.optionVersion
    );
    if (!option || option.kind === "external") {
      return true;
    }
    const prep = option.preparation;
    return (
      prep.elapsedTime._tag === "Unknown" ||
      prep.handsOnTime._tag === "Unknown" ||
      prep.startRequirement === "unknown" ||
      prep.substantialCookEvent === "unknown"
    );
  });
  const availabilityUnknown = version.coverage.filter((entry) => {
    if (
      entry.resolution._tag !== "MealOption" ||
      entry.resolution.option.kind === "external"
    ) {
      return false;
    }
    const weekday = new Date(`${entry.requirement.date}T00:00:00Z`).getUTCDay();
    return (
      snapshot.availability.filter(
        (item) =>
          item.personId === entry.requirement.personId &&
          item.occasionId === entry.requirement.occasion &&
          item.weekdays.includes(weekday)
      ).length !== 1
    );
  });
  const missingEquipment = version.coverage.filter((entry) => {
    if (entry.resolution._tag !== "MealOption") {
      return false;
    }
    const { resolution } = entry;
    const option = snapshot.options.find(
      (item) =>
        item.optionId === resolution.option.optionId &&
        item.optionVersion === resolution.option.optionVersion
    );
    return (
      option &&
      option.kind !== "external" &&
      option.preparation.requiredEquipment.some(
        (item) =>
          !snapshot.cookingCapacity.availableEquipment.some(
            (available) =>
              available.toLocaleLowerCase() === item.toLocaleLowerCase()
          )
      )
    );
  });
  const preparationWindowConflicts = version.coverage.filter((entry) => {
    if (
      entry.resolution._tag !== "MealOption" ||
      entry.resolution.option.kind === "external"
    ) {
      return false;
    }
    const { resolution } = entry;
    const option = snapshot.options.find(
      (item) =>
        item.optionId === resolution.option.optionId &&
        item.optionVersion === resolution.option.optionVersion
    );
    if (!option || option.kind === "external") {
      return false;
    }
    const weekday = new Date(`${entry.requirement.date}T00:00:00Z`).getUTCDay();
    const windows = snapshot.availability.filter(
      (item) =>
        item.personId === entry.requirement.personId &&
        item.occasionId === entry.requirement.occasion &&
        item.weekdays.includes(weekday)
    );
    const [window] = windows;
    if (
      windows.length !== 1 ||
      !window ||
      option.preparation.handsOnTime._tag === "Unknown" ||
      option.preparation.elapsedTime._tag === "Unknown"
    ) {
      return false;
    }
    return (
      option.preparation.handsOnTime.minutes >
        window.preparationWindowMinutes ||
      (option.preparation.startRequirement === "advance_start" &&
        window.handsOffStart !== "available") ||
      (option.preparation.startRequirement === "during_window" &&
        option.preparation.elapsedTime.minutes >
          window.preparationWindowMinutes)
    );
  });
  const substantialByWeek = new Map<number, number>();
  for (const event of version.cookEvents) {
    const option = snapshot.options.find(
      (item) =>
        item.optionId === event.option.optionId &&
        item.optionVersion === event.option.optionVersion
    );
    if (
      option &&
      option.kind !== "external" &&
      option.preparation.substantialCookEvent === "yes"
    ) {
      const week = Math.floor(
        (Date.parse(`${event.date}T00:00:00Z`) -
          Date.parse(`${weekStart}T00:00:00Z`)) /
          86_400_000 /
          7
      );
      substantialByWeek.set(week, (substantialByWeek.get(week) ?? 0) + 1);
    }
  }
  const cookingCapacityExceeded = [...substantialByWeek].some(
    ([, count]) =>
      count > snapshot.cookingCapacity.maximumSubstantialCookEventsPerWeek
  );
  return {
    availabilityUnknown,
    cookingCapacityExceeded,
    gaps,
    incompatibleSuitability,
    missingEquipment,
    overallocatedPrepared,
    preparationUnknown,
    preparationWindowConflicts,
    unconfirmedCarryOver,
    unknownSafety,
    unresolvedAmounts,
    unreviewedSuitability,
  };
};

export const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00.000Z`)
  );
