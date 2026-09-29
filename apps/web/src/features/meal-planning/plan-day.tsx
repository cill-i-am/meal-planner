import type {
  MealPlanCoverage,
  MealPlanResolution,
  MealPlanVersion,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";

import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/utils.js";
import { FoodCover } from "../food-book/index.js";
import { dateLabel, resolutionLabel } from "./plan-projection.js";

interface PlanPerson {
  readonly id: string;
  readonly displayName: string;
}

const personName = (people: readonly PlanPerson[], personId: string) =>
  people.find((person) => person.id === personId)?.displayName ??
  "Family member";

const plateQuantity = (resolution: MealPlanResolution) => {
  if (
    (resolution._tag === "MealOption" || resolution._tag === "Prepared") &&
    resolution.quantity !== null
  ) {
    return ` · ${resolution.quantity.amount} ${resolution.quantity.unit}`;
  }
  return "";
};

const occasionName = (snapshot: PlanningContentSnapshot, occasionId: string) =>
  snapshot.managedOccasions.find(
    (occasion) => occasion.occasionId === occasionId
  )?.label ?? "Meal";

const occasionKey = (snapshot: PlanningContentSnapshot, occasionId: string) => {
  const occasion = snapshot.managedOccasions.find(
    (item) => item.occasionId === occasionId
  );
  return occasion === undefined
    ? `id:${occasionId}`
    : `label:${occasion.label.normalize("NFC").trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase()}`;
};

const standardOccasionOrder = new Map([
  ["label:breakfast", 0],
  ["label:lunch", 1],
  ["label:dinner", 2],
  ["label:snacks", 3],
]);

const groupOccasions = (
  entries: readonly MealPlanCoverage[],
  snapshot: PlanningContentSnapshot
) => {
  const groups = new Map<
    string,
    { label: string; entries: MealPlanCoverage[] }
  >();
  for (const entry of entries) {
    const id = entry.requirement.occasion;
    const key = occasionKey(snapshot, id);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        entries: [entry],
        label: occasionName(snapshot, id),
      });
    } else {
      group.entries.push(entry);
    }
  }
  return [...groups]
    .map(([key, group]) => ({ key, ...group }))
    .toSorted((a, b) => {
      const aOrder = standardOccasionOrder.get(a.key);
      const bOrder = standardOccasionOrder.get(b.key);
      if (aOrder !== undefined || bOrder !== undefined) {
        return (
          (aOrder ?? Number.MAX_SAFE_INTEGER) -
          (bOrder ?? Number.MAX_SAFE_INTEGER)
        );
      }
      return a.key.localeCompare(b.key);
    });
};

const groupKey = (entry: MealPlanCoverage) => {
  const { resolution } = entry;
  if (resolution._tag === "MealOption") {
    return `event:${resolution.eventId}`;
  }
  if (resolution._tag === "Prepared") {
    return `prepared:${resolution.outputId}`;
  }
  if (resolution._tag === "External") {
    return `external:${resolution.description}`;
  }
  return `${resolution._tag}:${entry.requirement.personId}`;
};

const groupCoverage = (entries: readonly MealPlanCoverage[]) => {
  const groups = new Map<string, MealPlanCoverage[]>();
  for (const entry of entries) {
    const key = groupKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()];
};

const gapText = (resolution: MealPlanResolution) => {
  if (resolution._tag !== "Gap") {
    return null;
  }
  switch (resolution.reason) {
    case "no_compatible_option": {
      return "No confirmed suitable meal is available.";
    }
    case "routine_conflict": {
      return "A routine conflicts with this requirement.";
    }
    case "unconfirmed_suitability": {
      return "Suitability needs a person review.";
    }
    case "preparation_context_unresolved": {
      return "Preparation time, equipment or availability needs review.";
    }
    case "unavailable_prepared_food": {
      return "Prepared food is not confirmed available.";
    }
    case "dependent_output_removed": {
      return "An earlier cooking change removed this leftover.";
    }
    case "not_planned": {
      return "This meal has not been planned yet.";
    }
    default: {
      return resolution.reason satisfies never;
    }
  }
};

export const DayPlan = ({
  date,
  version,
  personFilter,
  people,
  snapshot,
  onChange,
}: {
  readonly date: string;
  readonly version: MealPlanVersion;
  readonly personFilter: string;
  readonly people: readonly PlanPerson[];
  readonly snapshot: PlanningContentSnapshot;
  readonly onChange?: ((entry: MealPlanCoverage) => void) | undefined;
}) => {
  const entries = version.coverage.filter(
    (entry) =>
      entry.requirement.date === date &&
      (personFilter === "all" || entry.requirement.personId === personFilter)
  );
  const occasions = groupOccasions(entries, snapshot);
  return (
    <section
      className="border-border bg-background rounded-3xl border p-5 md:p-7"
      aria-label={dateLabel(date, {
        day: "numeric",
        month: "long",
        weekday: "long",
      })}
    >
      <div className="mb-5 flex items-end justify-between gap-3">
        <h3 className="font-display text-4xl md:text-5xl">
          {dateLabel(date, { weekday: "long" })}
        </h3>
        <p className="text-muted-foreground text-sm">
          {dateLabel(date, { day: "numeric", month: "short" })}
        </p>
      </div>
      {occasions.map((occasion) => {
        const groups = groupCoverage(occasion.entries);
        return (
          <div key={occasion.key} className="mb-8 last:mb-0">
            <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
              {occasion.label}
            </p>
            <div className="divide-border mt-2 divide-y">
              {groups.map((group) => {
                const [first] = group;
                if (first === undefined) {
                  return null;
                }
                const { resolution } = first;
                const recipe =
                  resolution._tag === "MealOption"
                    ? snapshot.options.find(
                        (option) =>
                          option.optionId === resolution.option.optionId &&
                          option.optionVersion ===
                            resolution.option.optionVersion
                      )
                    : undefined;
                return (
                  <div key={groupKey(first)} className="py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-4">
                        {recipe && (
                          <FoodCover
                            cover={recipe.cover}
                            label={recipe.label}
                            className="size-16 md:size-20"
                          />
                        )}
                        <div>
                          <h4 className="font-display text-2xl leading-tight md:text-3xl">
                            {resolutionLabel(
                              first.resolution,
                              snapshot,
                              version.cookEvents
                            )}
                          </h4>
                          <p className="text-muted-foreground mt-1 text-sm leading-6">
                            {gapText(first.resolution) ??
                              first.resolution.rationale}
                          </p>
                        </div>
                      </div>
                      {first.resolution._tag === "Gap" && (
                        <Badge variant="secondary">Open</Badge>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {group.map((entry) =>
                        onChange === undefined ? (
                          <Badge
                            key={`${entry.requirement.personId}:${entry.requirement.occasion}`}
                            variant="outline"
                            className="h-auto min-h-7 whitespace-normal"
                          >
                            {personName(people, entry.requirement.personId)}
                            {plateQuantity(entry.resolution)}
                          </Badge>
                        ) : (
                          <Button
                            key={`${entry.requirement.personId}:${entry.requirement.occasion}`}
                            variant="outline"
                            size="sm"
                            onClick={() => onChange(entry)}
                          >
                            {personName(people, entry.requirement.personId)} ·
                            change plate
                          </Button>
                        )
                      )}
                      {recipe?.kind === "recipe" && (
                        <Button
                          size="sm"
                          variant="link"
                          render={
                            <a
                              href={`/?area=food&recipeId=${encodeURIComponent(recipe.recipeId)}`}
                            />
                          }
                        >
                          View recipe and cook
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {entries.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No managed meals for this day and person.
        </p>
      )}
    </section>
  );
};

const weekFocal = (
  entries: readonly MealPlanCoverage[],
  snapshot: PlanningContentSnapshot,
  version: MealPlanVersion
) => {
  const dinners = entries.filter((entry) =>
    occasionName(snapshot, entry.requirement.occasion)
      .toLocaleLowerCase()
      .includes("dinner")
  );
  const candidates = dinners.length > 0 ? dinners : entries;
  const counts = new Map<string, number>();
  for (const entry of candidates) {
    const label = resolutionLabel(
      entry.resolution,
      snapshot,
      version.cookEvents
    );
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let selected: MealPlanCoverage | undefined;
  for (const entry of candidates) {
    if (
      selected === undefined ||
      (counts.get(
        resolutionLabel(entry.resolution, snapshot, version.cookEvents)
      ) ?? 0) >
        (counts.get(
          resolutionLabel(selected.resolution, snapshot, version.cookEvents)
        ) ?? 0)
    ) {
      selected = entry;
    }
  }
  return selected;
};

const coverWord = (
  resolution: MealPlanResolution | undefined,
  label: string
) => {
  if (resolution?._tag === "External") {
    return "Out";
  }
  if (resolution?._tag === "Prepared") {
    return "Ready";
  }
  if (resolution?._tag === "Flexible") {
    return "Later";
  }
  if (resolution?._tag === "Skip") {
    return "Skip";
  }
  if (resolution?._tag === "Gap") {
    return "Open";
  }
  return label === "No managed meals" ? "—" : label.slice(0, 1).toUpperCase();
};

const WeekCover = ({
  entry,
  snapshot,
  version,
  label,
}: {
  readonly entry: MealPlanCoverage | undefined;
  readonly snapshot: PlanningContentSnapshot;
  readonly version: MealPlanVersion;
  readonly label: string;
}) => {
  const resolution = entry?.resolution;
  const preparedSource =
    resolution?._tag === "Prepared"
      ? (snapshot.preparedPortions.find(
          (portion) => portion.id === resolution.outputId
        )?.sourceOptionRef ??
        version.cookEvents.find((event) =>
          event.outputs.some(
            (output) => output.outputId === resolution.outputId
          )
        )?.option)
      : null;
  const optionRef =
    resolution?._tag === "MealOption" ? resolution.option : preparedSource;
  const option = snapshot.options.find(
    (item) =>
      item.optionId === optionRef?.optionId &&
      item.optionVersion === optionRef.optionVersion
  );
  if (option !== undefined) {
    return (
      <FoodCover
        cover={option.cover}
        label={option.label}
        className="size-full"
      />
    );
  }
  const word = coverWord(resolution, label);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "font-display grid size-full place-items-center rounded-full text-base xl:text-3xl",
        resolution?._tag === "External"
          ? "bg-primary text-primary-foreground"
          : "bg-accent text-foreground"
      )}
    >
      {word}
    </span>
  );
};

export const WeekPlan = ({
  days,
  version,
  personFilter,
  people,
  snapshot,
  onOpenDay,
}: {
  readonly days: readonly string[];
  readonly version: MealPlanVersion;
  readonly personFilter: string;
  readonly people: readonly PlanPerson[];
  readonly snapshot: PlanningContentSnapshot;
  readonly onOpenDay: (date: string) => void;
}) => (
  <div className="border-border border-y xl:grid xl:grid-cols-7 xl:gap-4 xl:border-y-0">
    {days.map((date) => {
      const entries = version.coverage.filter(
        (entry) =>
          entry.requirement.date === date &&
          (personFilter === "all" ||
            entry.requirement.personId === personFilter)
      );
      const focal = weekFocal(entries, snapshot, version);
      const focalLabel = focal
        ? resolutionLabel(focal.resolution, snapshot, version.cookEvents)
        : "No managed meals";
      const focalOccasionKey = focal
        ? occasionKey(snapshot, focal.requirement.occasion)
        : undefined;
      const baseline = groupOccasions(entries, snapshot)
        .map((occasion) => {
          const choices = [
            ...new Set(
              occasion.entries.map((entry) =>
                resolutionLabel(entry.resolution, snapshot, version.cookEvents)
              )
            ),
          ].filter(
            (choice) =>
              occasion.key !== focalOccasionKey || choice !== focalLabel
          );
          return { ...occasion, choices };
        })
        .filter((item) => item.choices.length > 0);
      const baselineText = baseline
        .map(({ label, choices }) => `${label}: ${choices.join(" / ")}`)
        .join(" · ");
      const compactBaseline = baseline
        .flatMap(({ choices }) => choices)
        .join(" · ");
      const otherDinnerChoices = baseline
        .filter(({ key }) => key === focalOccasionKey)
        .flatMap(({ choices }) => choices);
      const focalNote =
        otherDinnerChoices.length > 0
          ? `Also: ${otherDinnerChoices.join(" · ")}`
          : focal?.resolution.rationale ||
            (focal
              ? personName(people, focal.requirement.personId)
              : "Open the day to plan it");
      const gapCount = entries.filter(
        (entry) => entry.resolution._tag === "Gap"
      ).length;
      const weekday = dateLabel(date, { weekday: "short" });
      const day = dateLabel(date, { day: "numeric" });
      return (
        <button
          key={date}
          type="button"
          onClick={() => onOpenDay(date)}
          aria-label={`${dateLabel(date, { day: "numeric", month: "long", weekday: "long" })}: ${focalLabel}. ${baselineText || "Open the day for every plate"}. ${gapCount} open meals. Open day`}
          className="border-border focus-visible:outline-ring grid min-h-17 w-full grid-cols-[2rem_2.75rem_minmax(0,1fr)_0.875rem] items-center gap-3 border-b py-3 text-left last:border-b-0 focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 xl:grid-cols-1 xl:grid-rows-[auto_auto_minmax(7rem,1fr)_auto] xl:items-start xl:gap-0 xl:border-0 xl:py-0"
        >
          <span className="text-foreground flex flex-col text-xs xl:col-start-1 xl:row-start-1 xl:flex-row xl:gap-1.5 xl:font-medium xl:tracking-wider xl:uppercase">
            <span>{weekday}</span>
            <span className="text-base xl:text-xs">{day}</span>
          </span>
          <span className="size-11 shrink-0 overflow-hidden rounded-full xl:col-start-1 xl:row-start-2 xl:mt-6 xl:aspect-square xl:h-auto xl:w-full">
            <WeekCover
              entry={focal}
              snapshot={snapshot}
              version={version}
              label={focalLabel}
            />
          </span>
          <span className="min-w-0 xl:col-start-1 xl:row-start-3 xl:mt-4">
            <span className="text-foreground xl:font-display xl:text-task-desktop block truncate text-sm font-medium xl:line-clamp-3 xl:leading-7.25 xl:font-normal xl:whitespace-normal">
              {focalLabel}
            </span>
            <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs xl:mt-2 xl:whitespace-normal">
              <span className="xl:hidden">{compactBaseline || focalNote}</span>
              <span className="hidden xl:inline">{focalNote}</span>
            </span>
            {gapCount > 0 && (
              <span className="text-muted-foreground mt-1 hidden text-xs xl:block">
                {gapCount} {gapCount === 1 ? "open meal" : "open meals"}
              </span>
            )}
          </span>
          <span aria-hidden="true" className="text-sm xl:hidden">
            ↗
          </span>
          <span className="border-border hidden min-w-0 flex-col gap-1.5 border-t pt-4 xl:col-start-1 xl:row-start-4 xl:flex">
            {baseline.map(({ key, label, choices }) => (
              <span
                key={key}
                className="text-foreground block truncate text-xs"
              >
                <span className="font-semibold">
                  {label.slice(0, 1).toUpperCase()}
                </span>{" "}
                · {choices.join(" / ")}
              </span>
            ))}
            {baseline.length === 0 && (
              <span className="text-muted-foreground text-xs">
                All shown above
              </span>
            )}
          </span>
        </button>
      );
    })}
  </div>
);
