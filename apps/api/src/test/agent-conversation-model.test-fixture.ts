import { PlanScheduleRow } from "@meal-planner/agent-conversations-api";
import { Schema } from "effect";
import { Response as LocalResponse } from "miniflare";

import { ConversationModelContext } from "../features/agent-conversations/conversation.contract.js";
import { encodeKimiCompletion } from "../features/private-output/private-discovery-kimi-stream.test-fixtures.js";

export const agentConversationModelConfiguration = JSON.stringify({
  gatewayId: "synthetic-agent-conversation-local-only",
  maxOutputTokens: 1000,
  model: "@cf/moonshotai/kimi-k2.6",
  timeoutMs: 5000,
});

const ProviderRequest = Schema.Struct({
  body: Schema.Struct({
    messages: Schema.Array(
      Schema.Struct({ content: Schema.String, role: Schema.String })
    ),
  }),
  model: Schema.Literal("@cf/moonshotai/kimi-k2.6"),
});
type Context = typeof ConversationModelContext.Type;

const assertFixtureScope = (context: Context, phrase: string) => {
  if (
    (context.family === null && phrase !== "Set up my family") ||
    (context.family !== null && phrase === "Set up my family") ||
    (context.family === null && context.setupAccountDisplayName === null) ||
    (context.family !== null && context.setupAccountDisplayName !== null)
  ) {
    throw new Error("Unexpected conversation scope or private account name");
  }
};

const asksFirstFoodQuestion = (phrase: string) =>
  phrase === "Ask our first food question" ||
  phrase === "Ask our first food question.";

const defaultScheduleWeekdays = (
  label: string,
  weekdays: readonly number[]
) => {
  if (label === "Dinner") {
    return weekdays.filter((weekday) => weekday !== 1);
  }
  if (label === "Lunch") {
    return weekdays.filter((weekday) => weekday !== 3);
  }
  return weekdays;
};

const fullWeekProposal = (context: Context) => {
  const { plan, planningContent } = context;
  if (plan?.state !== "Draft" || planningContent === null) {
    throw new Error("Expected a selected draft and planning content");
  }
  const managed = planningContent.managedOccasions.filter(
    (occasion) => occasion.state === "managed"
  );
  if (plan.totalCoverage === 0 || managed.length === 0) {
    throw new Error("Expected managed coverage and a saved meal option");
  }
  const option = planningContent.options.find(
    (candidate) =>
      !managed.some((occasion) =>
        planningContent.suitabilityReviews.some(
          (review) =>
            review.personId === occasion.personId &&
            review.optionRef.kind === candidate.kind &&
            review.optionRef.optionId === candidate.optionId &&
            review.optionRef.optionVersion === candidate.optionVersion &&
            review.status === "incompatible"
        )
      )
  );
  if (option === undefined) {
    throw new Error("No shared option for managed coverage");
  }
  const optionRef = {
    kind: option.kind,
    optionId: option.optionId,
    optionVersion: option.optionVersion,
  };
  const knownYield = (() => {
    if (option.kind === "external") {
      return null;
    }
    if (option.kind === "packaged") {
      return option.quantity;
    }
    return option.yield;
  })();
  if (
    knownYield?._tag !== "Known" ||
    knownYield.unit !== "portion" ||
    knownYield.amount < 4
  ) {
    throw new Error("Expected a reviewed four-portion option yield");
  }
  const groups = new Map<string, typeof managed>();
  for (const occasion of managed) {
    const key = JSON.stringify([occasion.label, occasion.weekdays]);
    const group = groups.get(key) ?? [];
    group.push(occasion);
    groups.set(key, group);
  }
  const grouped = [...groups.values()];
  const dinner = grouped.find((occasions) => occasions[0]?.label === "Dinner");
  const lunch = grouped.find((occasions) => occasions[0]?.label === "Lunch");
  if (dinner === undefined || lunch === undefined) {
    throw new Error("Expected managed dinner and lunch for leftovers");
  }
  const rows = grouped.map((occasions, index) =>
    Schema.decodeUnknownSync(PlanScheduleRow)({
      key: `meal-${index + 1}`,
      resolution: {
        _tag: "MealOption",
        batchCount:
          option.kind === "recipe" || option.kind === "assembled" ? 1 : null,
        option: optionRef,
        preparedOutput: null,
      },
      targets: occasions.map((occasion) => ({
        occasionId: occasion.occasionId,
        personId: occasion.personId,
        quantity: { amount: 1, unit: knownYield.unit },
      })),
      weekIndices: null,
      weekdays: defaultScheduleWeekdays(
        occasions[0]?.label ?? "",
        occasions[0]?.weekdays ?? []
      ),
    })
  );
  rows.push(
    Schema.decodeUnknownSync(PlanScheduleRow)({
      key: "meal-mon-dinner",
      resolution: {
        _tag: "MealOption",
        batchCount: 1,
        option: optionRef,
        preparedOutput: { amount: 2, unit: "portion" },
      },
      targets: dinner.map((occasion) => ({
        occasionId: occasion.occasionId,
        personId: occasion.personId,
        quantity: { amount: 1, unit: "portion" },
      })),
      weekIndices: null,
      weekdays: [1],
    }),
    Schema.decodeUnknownSync(PlanScheduleRow)({
      key: "meal-wed-leftover",
      resolution: {
        _tag: "PreparedFromCook",
        daysBefore: 2,
        sourceRowKey: "meal-mon-dinner",
      },
      targets: lunch.map((occasion) => ({
        occasionId: occasion.occasionId,
        personId: occasion.personId,
        quantity: { amount: 1, unit: "portion" },
      })),
      weekIndices: null,
      weekdays: [3],
    })
  );
  return {
    blocks: [
      {
        _tag: "PlanScheduleProposal",
        expectedRevision: plan.revision,
        explanation: "Fill each managed meal with a saved option for review.",
        planId: plan.planId,
        rows,
      },
    ],
    reply: "I prepared the full draft week for your review.",
  };
};

/** Each accepted phrase has one bounded, context-derived proposal. Unknown input fails the fixture. */
export const agentConversationModelResponse = async (
  request: Pick<Request, "url" | "json">
) => {
  if (request.url !== "https://conversation-model.test/run") {
    throw new Error(
      "External network is forbidden in agent conversation tests"
    );
  }
  const input = Schema.decodeUnknownSync(ProviderRequest)(await request.json());
  const context = Schema.decodeUnknownSync(
    Schema.fromJsonString(ConversationModelContext)
  )(input.body.messages[1]?.content);
  const latest = input.body.messages.at(-1);
  if (latest?.role !== "user") {
    throw new Error("Expected an admitted user turn");
  }
  assertFixtureScope(context, latest.content);

  let output: {
    readonly reply: string;
    readonly blocks: readonly Record<string, unknown>[];
  };
  if (latest.content === "Set up my family") {
    const creatorName = context.setupAccountDisplayName;
    if (creatorName === null) {
      throw new Error("Authenticated account name is required for setup");
    }
    output = {
      blocks: [
        {
          _tag: "RosterProposal",
          creatorName,
          familyName: "The Test Table",
          people: [{ displayName: "Sam", kind: "dependant" }],
        },
      ],
      reply: "Review this family and the people who will join it.",
    };
  } else if (asksFirstFoodQuestion(latest.content)) {
    output = {
      blocks: [
        {
          _tag: "Question",
          foodTopic: "pasta",
          prompt: "Does pasta work for your family?",
          targetPersonId: null,
        },
      ],
      reply: "Let's start with an easy food question.",
    };
  } else if (latest.content === "Our family would enjoy pasta.") {
    output = {
      blocks: [
        {
          _tag: "Question",
          foodTopic: null,
          prompt: "Who enjoys it most?",
          targetPersonId: null,
        },
      ],
      reply: "Pasta sounds promising. Who enjoys it most?",
    };
  } else if (latest.content === "Sam likes pasta") {
    const child = context.people.find(
      (person) => person.kind === "dependant" && person.displayName === "Sam"
    );
    const profile = context.profiles.find(
      (value) => value.personId === child?.id
    );
    if (child === undefined || profile === undefined) {
      throw new Error("Expected saved child and current profile");
    }
    output = {
      blocks: [
        {
          _tag: "PersonFactProposal",
          change: {
            _tag: "Add",
            fact: {
              _tag: "FoodPreference",
              label: "Pasta",
              sentiment: "like",
              targetKind: "dish",
            },
          },
          explanation: "Sam likes pasta.",
          personId: child.id,
          profileVersion: profile.version,
        },
      ],
      reply: "Sam's preference is ready for your review.",
    };
  } else if (
    latest.content === "Set our meal occasions" &&
    context.planningContent !== null
  ) {
    const child = context.people.find(
      (person) => person.kind === "dependant" && person.displayName === "Sam"
    );
    if (child === undefined) {
      throw new Error("Expected the reviewed child for meal setup");
    }
    output = {
      blocks: [
        {
          _tag: "PlanningContentProposal",
          command: {
            _tag: "SetPersonManagedOccasions",
            entries: [
              {
                label: "Dinner",
                occasionId: null,
                state: "managed",
                weekdays: [0, 1, 2, 3, 4, 5, 6],
              },
            ],
            personId: child.id,
          },
          expectedContentVersion: context.planningContent.configVersion,
          explanation: "Plan dinner for Sam each day this week.",
        },
      ],
      reply: "I prepared the dinner schedule for your review.",
    };
  } else if (
    latest.content === "Add a meal option" &&
    context.planningContent !== null
  ) {
    output = {
      blocks: [
        {
          _tag: "PlanningContentProposal",
          command: {
            _tag: "PutOption",
            value: {
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
              cover: "pesto-pasta",
              kind: "assembled",
              label: "Pasta night",
              preparation: {
                attention: "low",
                cleanup: "low",
                elapsedTime: { _tag: "Known", minutes: 15 },
                handsOnTime: { _tag: "Known", minutes: 15 },
                requiredEquipment: ["hob"],
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
          },
          expectedContentVersion: context.planningContent.configVersion,
          explanation: "Save a pasta option to use in the plan.",
        },
      ],
      reply: "I prepared a pasta option for your review.",
    };
  } else if (latest.content === "Plan a full week") {
    output = fullWeekProposal(context);
  } else {
    throw new Error("Unexpected synthetic agent conversation context");
  }

  return new LocalResponse(
    encodeKimiCompletion({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            role: "assistant",
            tool_calls: [
              {
                function: {
                  arguments: JSON.stringify(output),
                  name: "submitConversationTurn",
                },
                id: "synthetic-agent-conversation",
                type: "function",
              },
            ],
          },
        },
      ],
      usage: { completion_tokens: 20, prompt_tokens: 100 },
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
};
