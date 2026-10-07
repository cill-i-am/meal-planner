import {
  ConversationModelBlock,
  ConversationScope,
  ConversationTurnId,
  PlanScheduleProposal,
  SubmitConversationTurn,
} from "@meal-planner/agent-conversations-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { projectConversationModelContext } from "./conversation-model-context.js";
import { prepareConversationBlocks } from "./conversation-proposals.js";
import { materializePlanSchedule } from "./conversation-schedule.js";
import { ConversationCanonicalContext } from "./conversation.contract.js";

const startDate = "2026-10-05";
const dateAt = (offset: number) =>
  new Date(Date.UTC(2026, 9, 5 + offset)).toISOString().slice(0, 10);
const people = Array.from(
  { length: 4 },
  (_, index) =>
    `person_${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000001`
);
const occasionIndexes = [0, 1, 2, 3];
const occasionFor = (personIndex: number, occasionIndex: number) =>
  `occasion_${String(personIndex + 1).padStart(2, "0")}${String(occasionIndex + 1).padStart(2, "0")}`;
const optionRef = {
  kind: "assembled",
  optionId: "option_0001",
  optionVersion: 1,
};

const contextFor = (weeks: number) => {
  const coverage = Array.from({ length: weeks * 7 }, (_, day) =>
    people.flatMap((personId, personIndex) =>
      occasionIndexes.map((occasionIndex) => ({
        requirement: {
          date: dateAt(day),
          occasion: occasionFor(personIndex, occasionIndex),
          personId,
        },
        resolution: {
          _tag: "Gap",
          rationale: "No saved routine covers this occasion yet.",
          reason: "not_planned",
        },
      }))
    )
  ).flat();
  return Schema.decodeUnknownSync(ConversationCanonicalContext)({
    family: {
      canManage: true,
      createdAtEpochMs: 1,
      id: "family-test",
      name: "The Table",
      setup: { completedAtEpochMs: 1, status: "complete" },
      slug: "the-table",
      updatedAtEpochMs: 1,
      version: 1,
    },
    people: people.map((id, index) => ({
      associationState: "unlinked",
      associationVersion: null,
      createdAtEpochMs: 1,
      displayName: `Person ${index + 1}`,
      id,
      isCurrentAdult: false,
      kind: "dependant",
      lifecycle: "active",
      updatedAtEpochMs: 1,
      version: 1,
    })),
    plan: {
      _tag: "Draft",
      audit: [],
      planId: "plan-one",
      proposed: {
        cookEvents: [],
        coverage,
        number: 1,
        pins: {
          configVersion: 0,
          content: [],
          contentSnapshots: [],
          people: [],
          preparedSources: [],
          routines: [],
        },
      },
      request: { requestKey: "request-one", startDate, weeks },
      revision: 1,
    },
    planningContent: {
      availability: [],
      configVersion: 0,
      cookingCapacity: {
        availableEquipment: [],
        maximumSubstantialCookEventsPerWeek: 21,
      },
      fallbacks: [],
      managedOccasions: people.flatMap((personId, personIndex) =>
        occasionIndexes.map((occasionIndex) => ({
          label: "Meal",
          occasionId: occasionFor(personIndex, occasionIndex),
          personId,
          state: "managed",
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        }))
      ),
      oneOffRoutines: [],
      options: [
        {
          ...optionRef,
          components: [
            {
              name: "Pasta",
              quantity: {
                _tag: "Known",
                amount: 500,
                sourceText: null,
                unit: "g",
              },
              substitutionPolicy: "ask",
            },
          ],
          cover: null,
          label: "Pasta meal",
          preparation: {
            attention: "low",
            cleanup: "low",
            elapsedTime: { _tag: "Known", minutes: 15 },
            handsOnTime: { _tag: "Known", minutes: 15 },
            requiredEquipment: [],
            startRequirement: "during_window",
            substantialCookEvent: "no",
          },
          yield: {
            _tag: "Known",
            amount: 4,
            sourceText: null,
            unit: "portion",
          },
        },
      ],
      preparedPortions: [],
      routines: [],
      suitabilityReviews: [],
    },
    profiles: [],
    setupAccountDisplayName: null,
  });
};

const proposalFor = (
  rows: readonly Record<string, unknown>[]
): PlanScheduleProposal =>
  Schema.decodeUnknownSync(PlanScheduleProposal)({
    _tag: "PlanScheduleProposal",
    expectedRevision: 1,
    explanation: "A shared weekly schedule for the family.",
    planId: "plan-one",
    rows,
  });

const sharedOptionRows = occasionIndexes.map((occasionIndex) => ({
  key: `meal-${occasionIndex + 1}`,
  resolution: {
    _tag: "MealOption",
    batchCount: null,
    option: optionRef,
    preparedOutput: null,
  },
  targets: people.map((personId, personIndex) => ({
    occasionId: occasionFor(personIndex, occasionIndex),
    personId,
    quantity: { amount: 1, unit: "portion" },
  })),
  weekIndices: null,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
}));

const [firstSharedRow] = sharedOptionRows;
if (firstSharedRow === undefined) {
  throw new Error("Expected a shared meal row");
}

const materialize = (
  weeks: number,
  rows: readonly Record<string, unknown>[]
) => {
  let nextId = 0;
  return materializePlanSchedule({
    context: contextFor(weeks),
    newId: () => {
      nextId += 1;
      return `generated-${nextId}`;
    },
    proposal: proposalFor(rows),
  });
};

describe("compact agent plan schedule", () => {
  it.each([2, 12])(
    "expands four bounded shared rows into the full %i-week matrix",
    (weeks) => {
      const context = contextFor(weeks);
      const proposal = proposalFor(sharedOptionRows);
      const change = materialize(weeks, sharedOptionRows);
      expect(change.coverage).toHaveLength(weeks * 7 * 4 * 4);
      expect(
        change.coverage.every((entry) => entry.resolution._tag === "MealOption")
      ).toBe(true);
      const sameMeal = change.coverage.filter(
        (entry) =>
          entry.requirement.date === startDate &&
          firstSharedRow?.targets.some(
            (target) =>
              target.personId === entry.requirement.personId &&
              target.occasionId === entry.requirement.occasion
          )
      );
      expect(
        new Set(
          sameMeal.map((entry) =>
            entry.resolution._tag === "MealOption"
              ? entry.resolution.eventId
              : "unplanned"
          )
        ).size
      ).toBe(1);
      expect(JSON.stringify(proposal).length).toBeLessThan(8192);
      if (weeks === 12) {
        expect(JSON.stringify(context).length).toBeGreaterThan(196_608);
        const modelContext = JSON.stringify(
          projectConversationModelContext(
            context,
            Schema.decodeUnknownSync(ConversationScope)({
              _tag: "FamilyShared",
              familyId: "family-test",
            })
          )
        );
        expect(modelContext.length).toBeLessThan(196_608);
        const toolSchema = Schema.toStandardJSONSchemaV1(
          Schema.toStandardSchemaV1(SubmitConversationTurn)
        )["~standard"].jsonSchema.input({ target: "draft-2020-12" });
        const requestBytes = new TextEncoder().encode(
          JSON.stringify({
            messages: [{ content: modelContext, role: "system" }],
            tools: [{ function: { parameters: toolSchema } }],
          })
        ).byteLength;
        expect(requestBytes).toBeLessThan(262_144);
        expect(JSON.stringify(change).length).toBeGreaterThan(262_144);
      }
    }
  );

  it("leaves unmatched requirements as explicit gaps and rejects overlaps", () => {
    const partial = { ...firstSharedRow, weekdays: [1] };
    const change = materialize(2, [partial]);
    expect(
      change.coverage.some((entry) => entry.resolution._tag === "Gap")
    ).toBe(true);
    expect(() =>
      materialize(2, [partial, { ...partial, key: "overlap" }])
    ).toThrow();
  });

  it("rejects duplicate row keys even when their requirements do not overlap", () => {
    const monday = { ...firstSharedRow, weekdays: [1] };
    const tuesday = { ...firstSharedRow, weekdays: [2] };
    expect(() => materialize(2, [monday, tuesday])).toThrow();
  });

  it("rejects stale options, unadmitted rows, and unknown or excessive output", () => {
    expect(() =>
      materialize(2, [
        {
          ...firstSharedRow,
          resolution: {
            ...firstSharedRow?.resolution,
            option: { ...optionRef, optionVersion: 2 },
          },
        },
      ])
    ).toThrow();
    expect(() =>
      materialize(2, [
        {
          ...firstSharedRow,
          targets: [{ occasionId: "occasion_missing", personId: people[0] }],
        },
      ])
    ).toThrow();
    expect(() =>
      materialize(2, [
        {
          ...firstSharedRow,
          targets: firstSharedRow.targets.map((target) => ({
            ...target,
            quantity: { amount: 20, unit: "portion" },
          })),
        },
      ])
    ).toThrow();
  });

  it("uses unequal per-person portions in one shared meal event", () => {
    const amounts = [1.5, 0.5, 1, 1];
    const row = {
      ...firstSharedRow,
      targets: firstSharedRow.targets.map((target, index) => ({
        ...target,
        quantity: {
          amount: amounts[index] ?? 1,
          unit: "portion",
        },
      })),
      weekIndices: [0],
      weekdays: [1],
    };
    const change = materialize(2, [row]);
    const meal = change.coverage.filter(
      ({ requirement }) =>
        requirement.date === startDate &&
        row.targets.some(
          (target) =>
            target.personId === requirement.personId &&
            target.occasionId === requirement.occasion
        )
    );
    expect(meal).toHaveLength(4);
    expect(
      meal.map(({ resolution }) =>
        resolution._tag === "MealOption" ? resolution.quantity?.amount : null
      )
    ).toEqual([1.5, 0.5, 1, 1]);
    expect(
      new Set(
        meal.map(({ resolution }) =>
          resolution._tag === "MealOption" ? resolution.eventId : "gap"
        )
      ).size
    ).toBe(1);
    expect(() =>
      materialize(2, [
        {
          ...row,
          targets: [{ ...row.targets[0], quantity: null }],
        },
      ])
    ).toThrow();
  });

  it("materializes reviewed cook batches and rejects excess prepared output", () => {
    const row = {
      ...firstSharedRow,
      resolution: {
        ...firstSharedRow?.resolution,
        batchCount: 2,
        preparedOutput: { amount: 4, unit: "portion" },
      },
      weekIndices: [0],
      weekdays: [1],
    };
    const change = materialize(2, [row]);
    expect(change.cookEvents).toHaveLength(1);
    expect(change.cookEvents[0]?.batchCount).toBe(2);
    expect(change.cookEvents[0]?.outputs[0]?.quantity.amount).toBe(4);
    expect(() =>
      materialize(2, [
        {
          ...row,
          resolution: {
            ...row.resolution,
            preparedOutput: { amount: 5, unit: "portion" },
          },
        },
      ])
    ).toThrow();
  });

  it("links Monday cook output to Wednesday prepared meals in one review", () => {
    const [, lunch] = sharedOptionRows;
    if (lunch === undefined) {
      throw new Error("Expected a lunch row");
    }
    const cook = {
      ...firstSharedRow,
      key: "cook-monday-dinner",
      resolution: {
        ...firstSharedRow.resolution,
        batchCount: 1,
        preparedOutput: { amount: 2, unit: "portion" },
      },
      targets: firstSharedRow.targets.slice(0, 2),
      weekdays: [1],
    };
    const prepared = {
      key: "leftovers-wednesday-lunch",
      resolution: {
        _tag: "PreparedFromCook",
        daysBefore: 2,
        sourceRowKey: cook.key,
      },
      targets: lunch.targets.slice(0, 2),
      weekIndices: null,
      weekdays: [3],
    };
    const change = materialize(2, [cook, prepared]);
    expect(
      change.cookEvents.map(({ eventId, outputs }) => ({
        eventId,
        outputId: outputs[0]?.outputId,
      }))
    ).toEqual([
      { eventId: "generated-1", outputId: "generated-3" },
      { eventId: "generated-2", outputId: "generated-4" },
    ]);
    expect(materialize(2, [prepared, cook])).toEqual(change);
    const mondayOutput = change.cookEvents[0]?.outputs[0]?.outputId;
    const nextMondayOutput = change.cookEvents[1]?.outputs[0]?.outputId;
    expect(mondayOutput).toBeDefined();
    expect(nextMondayOutput).not.toBe(mondayOutput);
    const wednesday = change.coverage.filter(
      ({ requirement }) => requirement.date === dateAt(2)
    );
    expect(
      wednesday.filter(
        ({ resolution }) =>
          resolution._tag === "Prepared" && resolution.outputId === mondayOutput
      )
    ).toHaveLength(2);
    expect(() =>
      materialize(2, [cook, { ...prepared, weekdays: [1] }])
    ).toThrow();
    expect(() =>
      proposalFor([
        cook,
        {
          ...prepared,
          resolution: { ...prepared.resolution, daysBefore: -2 },
        },
      ])
    ).toThrow();
    expect(() =>
      materialize(2, [
        cook,
        {
          ...prepared,
          resolution: {
            ...prepared.resolution,
            sourceRowKey: "missing-cook",
          },
        },
      ])
    ).toThrow();
    expect(() =>
      materialize(2, [
        cook,
        {
          ...prepared,
          targets: prepared.targets.map((target) => ({
            ...target,
            quantity: { amount: 2, unit: "portion" },
          })),
        },
      ])
    ).toThrow();
    expect(() =>
      materialize(2, [
        { ...cook, weekIndices: [0], weekdays: [0] },
        {
          ...prepared,
          resolution: { ...prepared.resolution, daysBefore: 1 },
          weekIndices: [1],
          weekdays: [1],
        },
      ])
    ).toThrow();
  });

  it("keeps same-date cook rows and their prepared outputs separate", () => {
    const [, lunch] = sharedOptionRows;
    if (lunch === undefined) {
      throw new Error("Expected a lunch row");
    }
    const cooks = [0, 2].map((start) => ({
      ...firstSharedRow,
      key: `cook-${start}`,
      resolution: {
        ...firstSharedRow.resolution,
        batchCount: 1,
        preparedOutput: { amount: 2, unit: "portion" },
      },
      targets: firstSharedRow.targets.slice(start, start + 2),
      weekIndices: [0],
      weekdays: [1],
    }));
    const prepared = [0, 2].map((start) => ({
      key: `prepared-${start}`,
      resolution: {
        _tag: "PreparedFromCook",
        daysBefore: 2,
        sourceRowKey: `cook-${start}`,
      },
      targets: lunch.targets.slice(start, start + 2),
      weekIndices: [0],
      weekdays: [3],
    }));
    const change = materialize(2, [...cooks, ...prepared]);
    expect(
      change.cookEvents.map(({ eventId, outputs }) => ({
        eventId,
        outputId: outputs[0]?.outputId,
        quantity: outputs[0]?.quantity,
      }))
    ).toEqual([
      {
        eventId: "generated-1",
        outputId: "generated-3",
        quantity: { amount: 2, unit: "portion" },
      },
      {
        eventId: "generated-2",
        outputId: "generated-4",
        quantity: { amount: 2, unit: "portion" },
      },
    ]);
    expect(
      change.coverage
        .filter(
          ({ requirement }) =>
            requirement.date === dateAt(2) &&
            lunch.targets.some(
              (target) => target.occasionId === requirement.occasion
            )
        )
        .map(({ resolution }) =>
          resolution._tag === "Prepared" ? resolution.outputId : null
        )
    ).toEqual(["generated-3", "generated-3", "generated-4", "generated-4"]);
  });

  it("rejects prepared meals whose source row has no cook output", () => {
    const [, lunch] = sharedOptionRows;
    if (lunch === undefined) {
      throw new Error("Expected a lunch row");
    }
    const meal = {
      ...firstSharedRow,
      weekIndices: [0],
      weekdays: [1],
    };
    const prepared = {
      key: "prepared-without-output",
      resolution: {
        _tag: "PreparedFromCook",
        daysBefore: 2,
        sourceRowKey: meal.key,
      },
      targets: lunch.targets,
      weekIndices: [0],
      weekdays: [3],
    };
    expect(() => materialize(2, [meal, prepared])).toThrow();
  });

  it("saves a compact model schedule as one exact canonical review block", () => {
    const context = contextFor(2);
    const [block] = prepareConversationBlocks({
      blocks: [
        Schema.decodeUnknownSync(ConversationModelBlock)(
          proposalFor(sharedOptionRows)
        ),
      ],
      context,
      focusPersonId: null,
      scope: Schema.decodeUnknownSync(ConversationScope)({
        _tag: "FamilyShared",
        familyId: "family-test",
      }),
      turnId: Schema.decodeUnknownSync(ConversationTurnId)(
        "run-1790634000000-a1b2c3"
      ),
    });
    expect(block?._tag).toBe("PlanChangeProposal");
    if (block?._tag !== "PlanChangeProposal") {
      throw new Error("Expected the canonical review block");
    }
    expect(block.change._tag).toBe("ReplaceDraftPlan");
    if (block.change._tag === "ReplaceDraftPlan") {
      expect(block.change.coverage).toHaveLength(224);
    }
  });
});
