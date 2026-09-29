import type { PlanScheduleProposal } from "@meal-planner/agent-conversations-api";
import { MealPlanChange } from "@meal-planner/household-api";
import type {
  MealOption,
  MealPlanCookEvent,
  MealPlanCoverage,
  MealPlanQuantity,
  MealPlanResolution,
  PlanningOptionRef,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { ConversationModelFailure } from "./conversation-model.js";
import type { ConversationCanonicalContext } from "./conversation.contract.js";

const invalid = (): never => {
  throw new ConversationModelFailure({ reason: "invalid_output" });
};

const dayMs = 86_400_000;
const epochDay = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / dayMs;
const dateAt = (start: string, days: number) =>
  new Date((epochDay(start) + days) * dayMs).toISOString().slice(0, 10);
const requirementKey = (requirement: MealPlanCoverage["requirement"]) =>
  JSON.stringify([
    requirement.date,
    requirement.occasion,
    requirement.personId,
  ]);
const optionKey = (ref: PlanningOptionRef) =>
  JSON.stringify([ref.kind, ref.optionId, ref.optionVersion]);
const unique = (values: readonly (number | string)[]) =>
  new Set(values).size === values.length;

interface EventAllocation {
  readonly date: MealPlanCookEvent["date"];
  readonly eventId: string;
  readonly option: PlanningOptionRef;
  readonly optionValue: MealOption;
  amount: number;
  batchCount: number | null;
  preparedOutput: MealPlanCookEvent["outputs"][number]["quantity"] | null;
  preparedOutputId: string | null;
  unit: string;
}

interface DeferredPrepared {
  readonly choice: Extract<
    PlanScheduleProposal["rows"][number]["resolution"],
    { readonly _tag: "PreparedFromCook" }
  >;
  readonly key: string;
  readonly quantity: MealPlanQuantity;
  readonly requirement: MealPlanCoverage["requirement"];
}

const knownYield = (option: MealOption) => {
  if (option.kind === "external") {
    return null;
  }
  const quantity = option.kind === "packaged" ? option.quantity : option.yield;
  return quantity._tag === "Known" ? quantity : null;
};

/** Expand compact model rows only against the admitted Draft requirement matrix. */
// eslint-disable-next-line complexity -- This boundary expands bounded rows and validates exact canonical allocations before saving one review block.
export const materializePlanSchedule = (input: {
  readonly proposal: PlanScheduleProposal;
  readonly context: ConversationCanonicalContext;
  readonly newId: () => string;
}): Extract<MealPlanChange, { readonly _tag: "ReplaceDraftPlan" }> => {
  const { context, newId, proposal } = input;
  const { plan, planningContent: content } = context;
  if (
    plan?._tag !== "Draft" ||
    plan.planId !== proposal.planId ||
    plan.revision !== proposal.expectedRevision ||
    content === null
  ) {
    return invalid();
  }
  const requirements = plan.proposed.coverage.map(
    ({ requirement }) => requirement
  );
  const admitted = new Set(requirements.map(requirementKey));
  if (admitted.size !== requirements.length) {
    return invalid();
  }
  const { startDate: start, weeks } = plan.request;
  const assigned = new Map<string, MealPlanResolution>();
  const claimed = new Set<string>();
  const events = new Map<string, EventAllocation>();
  const preparedAllocations = new Map<string, number>();
  const deferredPrepared: DeferredPrepared[] = [];
  const rowKeys = new Set<string>();
  const outputSources = new Map<string, Set<EventAllocation>>();

  for (const row of proposal.rows) {
    if (rowKeys.has(row.key)) {
      return invalid();
    }
    rowKeys.add(row.key);
    const selectedWeeks =
      row.weekIndices ?? Array.from({ length: weeks }, (_, index) => index);
    if (
      !unique(
        row.targets.map(({ occasionId, personId }) =>
          JSON.stringify([personId, occasionId])
        )
      ) ||
      !unique(row.weekdays) ||
      !unique(selectedWeeks) ||
      selectedWeeks.some((index) => index >= weeks)
    ) {
      return invalid();
    }
    const expectedMatches =
      row.targets.length * row.weekdays.length * selectedWeeks.length;
    const matches = requirements.filter((requirement) => {
      const days = epochDay(requirement.date) - epochDay(start);
      const week = Math.floor(days / 7);
      const weekday = new Date(`${requirement.date}T00:00:00.000Z`).getUTCDay();
      return (
        row.targets.some(
          (target) =>
            target.personId === requirement.personId &&
            target.occasionId === requirement.occasion
        ) &&
        row.weekdays.includes(weekday) &&
        selectedWeeks.includes(week)
      );
    });
    if (matches.length !== expectedMatches) {
      return invalid();
    }
    for (const requirement of matches) {
      const key = requirementKey(requirement);
      if (!admitted.has(key) || claimed.has(key)) {
        return invalid();
      }
      claimed.add(key);
      const choice = row.resolution;
      const target = row.targets.find(
        (entry) =>
          entry.personId === requirement.personId &&
          entry.occasionId === requirement.occasion
      );
      if (target === undefined) {
        return invalid();
      }
      const { quantity } = target;
      switch (choice._tag) {
        case "MealOption": {
          if (quantity === null) {
            return invalid();
          }
          const option = content.options.find(
            (candidate) => optionKey(candidate) === optionKey(choice.option)
          );
          if (
            option === undefined ||
            (choice.preparedOutput !== null && choice.batchCount === null)
          ) {
            return invalid();
          }
          const yieldQuantity = knownYield(option);
          if (
            (option.kind !== "external" &&
              (yieldQuantity === null ||
                yieldQuantity.unit !== quantity.unit)) ||
            (choice.batchCount !== null && option.kind === "external") ||
            (choice.preparedOutput !== null &&
              (yieldQuantity === null ||
                choice.preparedOutput.unit !== yieldQuantity.unit))
          ) {
            return invalid();
          }
          const eventKey = JSON.stringify([
            requirement.date,
            row.key,
            optionKey(choice.option),
          ]);
          let event = events.get(eventKey);
          if (event === undefined) {
            event = {
              amount: 0,
              batchCount: choice.batchCount,
              date: requirement.date,
              eventId: newId(),
              option: choice.option,
              optionValue: option,
              preparedOutput: choice.preparedOutput,
              preparedOutputId: null,
              unit: quantity.unit,
            };
            events.set(eventKey, event);
          } else if (
            event.unit !== quantity.unit ||
            (choice.batchCount !== null &&
              event.batchCount !== null &&
              event.batchCount !== choice.batchCount) ||
            (choice.preparedOutput !== null &&
              event.preparedOutput !== null &&
              JSON.stringify(event.preparedOutput) !==
                JSON.stringify(choice.preparedOutput))
          ) {
            return invalid();
          }
          event.batchCount ??= choice.batchCount;
          event.preparedOutput ??= choice.preparedOutput;
          event.amount += quantity.amount;
          if (choice.preparedOutput !== null) {
            const sourceKey = JSON.stringify([row.key, requirement.date]);
            const sources = outputSources.get(sourceKey) ?? new Set();
            sources.add(event);
            outputSources.set(sourceKey, sources);
          }
          assigned.set(key, {
            _tag: "MealOption",
            eventId: event.eventId,
            option: choice.option,
            quantity,
            rationale: "Assigned by the reviewed agent schedule.",
          });
          break;
        }
        case "Prepared": {
          if (quantity === null) {
            return invalid();
          }
          const portion = content.preparedPortions.find(
            (candidate) => candidate.id === choice.outputId
          );
          const days = epochDay(requirement.date) - epochDay(start);
          const weekStart = dateAt(start, Math.floor(days / 7) * 7);
          const sourceRef = portion?.sourceOptionRef;
          if (
            portion === undefined ||
            (portion.state !== "available" && portion.state !== "reserved") ||
            portion.confirmedForWeekStart !== weekStart ||
            sourceRef === null ||
            sourceRef === undefined ||
            !content.options.some(
              (option) => optionKey(option) === optionKey(sourceRef)
            ) ||
            portion.quantity.unit !== quantity.unit
          ) {
            return invalid();
          }
          const reservedElsewhere = portion.reservations
            .filter(({ planId }) => planId !== plan.request.requestKey)
            .reduce((total, reservation) => total + reservation.amount, 0);
          const used =
            (preparedAllocations.get(choice.outputId) ?? 0) + quantity.amount;
          if (used > portion.remainingAmount - reservedElsewhere + 1e-9) {
            return invalid();
          }
          preparedAllocations.set(choice.outputId, used);
          assigned.set(key, {
            _tag: "Prepared",
            outputId: choice.outputId,
            quantity,
            rationale: "Uses reviewed prepared food.",
          });
          break;
        }
        case "PreparedFromCook": {
          if (quantity === null) {
            return invalid();
          }
          deferredPrepared.push({ choice, key, quantity, requirement });
          break;
        }
        case "External": {
          if (quantity !== null) {
            return invalid();
          }
          assigned.set(key, {
            _tag: "External",
            description: choice.description,
            rationale: "Scheduled as an external meal.",
          });
          break;
        }
        case "Skip": {
          if (quantity !== null) {
            return invalid();
          }
          assigned.set(key, {
            _tag: "Skip",
            rationale: "The adult will skip this managed occasion.",
          });
          break;
        }
        case "Flexible": {
          if (quantity !== null) {
            return invalid();
          }
          assigned.set(key, {
            _tag: "Flexible",
            rationale: "The adult will choose this meal later.",
          });
          break;
        }
        case "Gap": {
          if (quantity !== null) {
            return invalid();
          }
          assigned.set(key, {
            _tag: "Gap",
            rationale: "This meal needs an adult decision.",
            reason: choice.reason,
          });
          break;
        }
        default: {
          return choice satisfies never;
        }
      }
    }
  }
  const cookEvents: MealPlanCookEvent[] = [];
  for (const event of events.values()) {
    const yieldQuantity = knownYield(event.optionValue);
    if (
      event.optionValue.kind !== "external" &&
      (yieldQuantity === null ||
        event.amount + (event.preparedOutput?.amount ?? 0) >
          yieldQuantity.amount * (event.batchCount ?? 1) + 1e-9)
    ) {
      return invalid();
    }
    if (event.batchCount !== null) {
      const outputs: MealPlanCookEvent["outputs"] =
        event.preparedOutput === null
          ? []
          : [
              {
                outputId: newId(),
                quantity: event.preparedOutput,
                source: "adult_confirmed",
              },
            ];
      event.preparedOutputId = outputs[0]?.outputId ?? null;
      cookEvents.push({
        batchCount: event.batchCount,
        date: event.date,
        eventId: event.eventId,
        option: event.option,
        outputs,
      });
    }
  }
  const generatedAllocations = new Map<string, number>();
  for (const { choice, key, quantity, requirement } of deferredPrepared) {
    const sourceDate = dateAt(requirement.date, -choice.daysBefore);
    const sourceWeek = Math.floor((epochDay(sourceDate) - epochDay(start)) / 7);
    const consumptionWeek = Math.floor(
      (epochDay(requirement.date) - epochDay(start)) / 7
    );
    const sources = outputSources.get(
      JSON.stringify([choice.sourceRowKey, sourceDate])
    );
    if (
      sourceWeek < 0 ||
      sourceWeek !== consumptionWeek ||
      sources?.size !== 1
    ) {
      return invalid();
    }
    const [source] = sources;
    if (
      source === undefined ||
      source.preparedOutput === null ||
      source.preparedOutputId === null ||
      source.preparedOutput.unit !== quantity.unit
    ) {
      return invalid();
    }
    const used =
      (generatedAllocations.get(source.preparedOutputId) ?? 0) +
      quantity.amount;
    if (used > source.preparedOutput.amount + 1e-9) {
      return invalid();
    }
    generatedAllocations.set(source.preparedOutputId, used);
    assigned.set(key, {
      _tag: "Prepared",
      outputId: source.preparedOutputId,
      quantity,
      rationale: "Uses a reviewed earlier cook output.",
    });
  }
  const coverage: MealPlanCoverage[] = requirements.map((requirement) => ({
    requirement,
    resolution: assigned.get(requirementKey(requirement)) ?? {
      _tag: "Gap",
      rationale: "No reviewed schedule row covers this meal.",
      reason: "not_planned",
    },
  }));
  const change = Schema.decodeUnknownSync(MealPlanChange)({
    _tag: "ReplaceDraftPlan",
    cookEvents,
    coverage,
  });
  if (change._tag !== "ReplaceDraftPlan") {
    return invalid();
  }
  return change;
};
