import {
  ConversationBlock,
  ConversationBlockId,
  ConversationModelBlock,
  PlanningSetupCommand,
} from "@meal-planner/agent-conversations-api";
import type {
  ConversationScope,
  ConversationTurnId,
  PlanningSetupModelCommand,
} from "@meal-planner/agent-conversations-api";
import type {
  MealPlanChange,
  MealPlanCoverage,
  PlanningOptionRef,
  RoutineChoice,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { ConversationModelFailure } from "./conversation-model.js";
import { materializePlanSchedule } from "./conversation-schedule.js";
import type { ConversationCanonicalContext } from "./conversation.contract.js";

const invalid = (): never => {
  throw new ConversationModelFailure({ reason: "invalid_output" });
};

const activePerson = (
  context: ConversationCanonicalContext,
  personId: string
) =>
  context.people.some(
    (person) => person.id === personId && person.lifecycle === "active"
  );

const optionIsCurrent = (
  context: ConversationCanonicalContext,
  ref: PlanningOptionRef
) =>
  context.planningContent?.options.some(
    (option) =>
      option.optionId === ref.optionId &&
      option.optionVersion === ref.optionVersion &&
      option.kind === ref.kind
  ) ?? false;

const routineRefs = (choice: RoutineChoice) => {
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
      const checkedResult: readonly PlanningOptionRef[] =
        choice satisfies never;
      return checkedResult;
    }
  }
};

const coverageIsCurrent = (
  context: ConversationCanonicalContext,
  coverage: MealPlanCoverage
) =>
  activePerson(context, coverage.requirement.personId) &&
  (coverage.resolution._tag !== "MealOption" ||
    optionIsCurrent(context, coverage.resolution.option));

const planChangeIsCurrent = (
  context: ConversationCanonicalContext,
  change: MealPlanChange
) => {
  switch (change._tag) {
    case "SetCoverage": {
      const checkedResult: boolean = coverageIsCurrent(context, change);
      return checkedResult;
    }
    case "ReplaceMealEvent": {
      const checkedResult: boolean = optionIsCurrent(context, change.option);
      return checkedResult;
    }
    case "SetCookEvent": {
      const checkedResult: boolean = optionIsCurrent(
        context,
        change.event.option
      );
      return checkedResult;
    }
    case "RemoveCookEvent": {
      const checkedResult = true;
      return checkedResult;
    }
    case "RefreshInputs": {
      const checkedResult = false;
      return checkedResult;
    }
    case "ReplaceDraftPlan": {
      const checkedResult: boolean =
        change.coverage.every((entry) => coverageIsCurrent(context, entry)) &&
        change.cookEvents.every((event) =>
          optionIsCurrent(context, event.option)
        );
      return checkedResult;
    }
    default: {
      const checkedResult: boolean = change satisfies never;
      return checkedResult;
    }
  }
};

const validQuestion = (
  block: Extract<ConversationModelBlock, { _tag: "Question" }>,
  context: ConversationCanonicalContext,
  focusPersonId: string | null,
  scope: ConversationScope
) =>
  (scope._tag === "FamilyShared" || block.foodTopic === null) &&
  (focusPersonId === null || block.targetPersonId === focusPersonId) &&
  (block.targetPersonId === null ||
    (scope._tag === "FamilyShared" &&
      activePerson(context, block.targetPersonId)));

const validFact = (
  block: Extract<ConversationModelBlock, { _tag: "PersonFactProposal" }>,
  context: ConversationCanonicalContext,
  focusPersonId: string | null
) => {
  if (
    (focusPersonId !== null && focusPersonId !== block.personId) ||
    !activePerson(context, block.personId)
  ) {
    return false;
  }
  const profile = context.profiles.find(
    (candidate) => candidate.personId === block.personId
  );
  if (profile === undefined || profile.version !== block.profileVersion) {
    return false;
  }
  if (block.change._tag === "Add") {
    return true;
  }
  const { factId } = block.change;
  const previous = profile.facts.find((fact) => fact.id === factId);
  if (previous === undefined) {
    return false;
  }
  return (
    block.change._tag !== "Replace" ||
    previous.value._tag !== "FoodPreference" ||
    block.change.fact._tag === "FoodPreference"
  );
};

const reviewedBefore = (
  block: Extract<ConversationModelBlock, { _tag: "PersonFactProposal" }>,
  context: ConversationCanonicalContext
) => {
  if (block.change._tag === "Add") {
    return null;
  }
  const { factId } = block.change;
  return (
    context.profiles
      .find((profile) => profile.personId === block.personId)
      ?.facts.find((fact) => fact.id === factId)?.value ?? null
  );
};

const validRoutine = (
  block: Extract<ConversationModelBlock, { _tag: "RoutineProposal" }>,
  context: ConversationCanonicalContext,
  focusPersonId: string | null
) => {
  const content = context.planningContent;
  if (
    content === null ||
    content.configVersion !== block.expectedContentVersion
  ) {
    return false;
  }
  const personId =
    block.routine.scope._tag === "Person" ? block.routine.scope.personId : null;
  if (
    (focusPersonId !== null && focusPersonId !== personId) ||
    (personId !== null && !activePerson(context, personId))
  ) {
    return false;
  }
  return (
    content.managedOccasions.some(
      (occasion) =>
        occasion.occasionId === block.routine.occasionId &&
        (personId === null || occasion.personId === personId)
    ) &&
    routineRefs(block.routine.choice).every((ref) =>
      optionIsCurrent(context, ref)
    )
  );
};

const validPlanningSetup = (
  block: Extract<ConversationModelBlock, { _tag: "PlanningContentProposal" }>,
  context: ConversationCanonicalContext,
  focusPersonId: string | null
) => {
  const content = context.planningContent;
  if (
    content === null ||
    content.configVersion !== block.expectedContentVersion
  ) {
    const checkedResult = false;
    return checkedResult;
  }
  const { command } = block;
  switch (command._tag) {
    case "SetPersonManagedOccasions": {
      const checkedResult: boolean =
        activePerson(context, command.personId) &&
        (focusPersonId === null || focusPersonId === command.personId) &&
        command.entries.every(
          (entry) =>
            entry.occasionId === null ||
            content.managedOccasions.some(
              (saved) =>
                saved.occasionId === entry.occasionId &&
                saved.personId === command.personId
            )
        );
      return checkedResult;
    }
    case "SetPersonAvailability": {
      const checkedResult: boolean =
        activePerson(context, command.personId) &&
        (focusPersonId === null || focusPersonId === command.personId) &&
        command.entries.every(
          (entry) =>
            entry.personId === command.personId &&
            content.managedOccasions.some(
              (saved) =>
                saved.personId === command.personId &&
                saved.occasionId === entry.occasionId
            )
        );
      return checkedResult;
    }
    case "SetCookingCapacity": {
      const checkedResult = true;
      return checkedResult;
    }
    case "PutOption": {
      const checkedResult = true;
      return checkedResult;
    }
    case "PutFallback": {
      const checkedResult: boolean =
        activePerson(context, command.value.personId) &&
        (focusPersonId === null || focusPersonId === command.value.personId) &&
        optionIsCurrent(context, command.value.optionRef) &&
        command.value.occasionIds.every((occasionId) =>
          content.managedOccasions.some(
            (saved) =>
              saved.personId === command.value.personId &&
              saved.occasionId === occasionId
          )
        );
      return checkedResult;
    }
    default: {
      const checkedResult: boolean = command satisfies never;
      return checkedResult;
    }
  }
};

const materializePlanningSetup = (command: PlanningSetupModelCommand) => {
  switch (command._tag) {
    case "SetPersonManagedOccasions": {
      const checkedResult: PlanningSetupCommand = Schema.decodeUnknownSync(
        PlanningSetupCommand
      )({
        ...command,
        entries: command.entries.map((entry) => ({
          ...entry,
          occasionId: entry.occasionId ?? crypto.randomUUID(),
          personId: command.personId,
        })),
      });
      return checkedResult;
    }
    case "SetPersonAvailability":
    case "SetCookingCapacity": {
      const checkedResult: PlanningSetupCommand = command;
      return checkedResult;
    }
    case "PutOption": {
      const checkedResult: PlanningSetupCommand = Schema.decodeUnknownSync(
        PlanningSetupCommand
      )({
        _tag: "PutOption",
        value: {
          ...command.value,
          optionId: crypto.randomUUID(),
          optionVersion: 1,
        },
      });
      return checkedResult;
    }
    case "PutFallback": {
      const checkedResult: PlanningSetupCommand = Schema.decodeUnknownSync(
        PlanningSetupCommand
      )({
        _tag: "PutFallback",
        value: { ...command.value, id: crypto.randomUUID(), version: 1 },
      });
      return checkedResult;
    }
    default: {
      const checkedResult: PlanningSetupCommand = command satisfies never;
      return checkedResult;
    }
  }
};

const validPlan = (
  block: Extract<ConversationModelBlock, { _tag: "PlanChangeProposal" }>,
  context: ConversationCanonicalContext
) =>
  context.plan !== null &&
  context.plan.planId === block.planId &&
  context.plan.revision === block.expectedRevision &&
  planChangeIsCurrent(context, block.change);

const validRecipe = (
  block: Extract<ConversationModelBlock, { _tag: "RecipeDetails" }>,
  context: ConversationCanonicalContext
) =>
  context.planningContent?.options.some(
    (option) =>
      option.kind === "recipe" && option.recipeImportId === block.recipeId
  ) ?? false;

const validBlock = (
  block: ConversationModelBlock,
  input: {
    readonly context: ConversationCanonicalContext;
    readonly focusPersonId: string | null;
    readonly scope: ConversationScope;
  }
) => {
  const { context, focusPersonId, scope } = input;
  if (block._tag === "Question") {
    const checkedResult: boolean = validQuestion(
      block,
      context,
      focusPersonId,
      scope
    );
    return checkedResult;
  }
  if (block._tag === "RosterProposal") {
    const checkedResult: boolean = scope._tag === "AccountPrivateSetup";
    return checkedResult;
  }
  if (scope._tag !== "FamilyShared") {
    const checkedResult = false;
    return checkedResult;
  }
  switch (block._tag) {
    case "PersonFactProposal": {
      const checkedResult: boolean = validFact(block, context, focusPersonId);
      return checkedResult;
    }
    case "RoutineProposal": {
      const checkedResult: boolean = validRoutine(
        block,
        context,
        focusPersonId
      );
      return checkedResult;
    }
    case "PlanningContentProposal": {
      const checkedResult: boolean = validPlanningSetup(
        block,
        context,
        focusPersonId
      );
      return checkedResult;
    }
    case "PlanChangeProposal": {
      const checkedResult: boolean = validPlan(block, context);
      return checkedResult;
    }
    case "PlanScheduleProposal": {
      const checkedResult: boolean =
        context.plan?._tag === "Draft" &&
        context.plan.planId === block.planId &&
        context.plan.revision === block.expectedRevision &&
        context.planningContent !== null;
      return checkedResult;
    }
    case "RecipeDetails": {
      const checkedResult: boolean = validRecipe(block, context);
      return checkedResult;
    }
    default: {
      const checkedResult: boolean = block satisfies never;
      return checkedResult;
    }
  }
};

export const prepareConversationBlocks = (input: {
  readonly blocks: readonly ConversationModelBlock[];
  readonly context: ConversationCanonicalContext;
  readonly focusPersonId: string | null;
  readonly previousRoster?:
    | Extract<ConversationBlock, { _tag: "RosterProposal" }>
    | undefined;
  readonly scope: ConversationScope;
  readonly turnId: typeof ConversationTurnId.Type;
}) => {
  const { context, scope } = input;
  if (
    (scope._tag === "AccountPrivateSetup" &&
      (context.family !== null || context.people.length > 0)) ||
    (scope._tag === "FamilyShared" && context.family?.id !== scope.familyId)
  ) {
    const checkedResult: readonly ConversationBlock[] = invalid();
    return checkedResult;
  }
  {
    const checkedResult: readonly ConversationBlock[] = input.blocks.map(
      (candidate) => {
        const block = Schema.decodeUnknownSync(ConversationModelBlock, {
          onExcessProperty: "error",
        })(candidate);
        if (!validBlock(block, input)) {
          return invalid();
        }
        const id = Schema.decodeUnknownSync(ConversationBlockId)(
          crypto.randomUUID()
        );
        const common = {
          id,
          revision: 1,
          status: "proposed" as const,
          turnId: input.turnId,
        };
        if (block._tag === "PersonFactProposal") {
          const before = reviewedBefore(block, context);
          return Schema.decodeUnknownSync(ConversationBlock)({
            ...block,
            ...common,
            requiresSafetyConfirmation:
              (block.change._tag === "Replace" ||
                block.change._tag === "Remove") &&
              before !== null &&
              before._tag !== "FoodPreference",
            reviewedBefore: before,
          });
        }
        if (block._tag === "PlanningContentProposal") {
          return Schema.decodeUnknownSync(ConversationBlock)({
            ...block,
            ...common,
            command: materializePlanningSetup(block.command),
          });
        }
        if (block._tag === "PlanScheduleProposal") {
          return Schema.decodeUnknownSync(ConversationBlock)({
            _tag: "PlanChangeProposal",
            ...common,
            change: materializePlanSchedule({
              context,
              newId: () => crypto.randomUUID(),
              proposal: block,
            }),
            expectedRevision: block.expectedRevision,
            explanation: block.explanation,
            planId: block.planId,
          });
        }
        if (block._tag === "RosterProposal") {
          const available = new Map<string, string[]>();
          for (const person of input.previousRoster?.people ?? []) {
            const key = `${person.kind}:${person.displayName.toLocaleLowerCase()}`;
            const ids = available.get(key) ?? [];
            ids.push(person.draftId);
            available.set(key, ids);
          }
          return Schema.decodeUnknownSync(ConversationBlock)({
            ...block,
            ...common,
            people: block.people.map((person) => ({
              ...person,
              draftId:
                available
                  .get(
                    `${person.kind}:${person.displayName.toLocaleLowerCase()}`
                  )
                  ?.shift() ?? crypto.randomUUID(),
            })),
          });
        }
        return Schema.decodeUnknownSync(ConversationBlock)({
          ...block,
          ...common,
        });
      }
    );
    return checkedResult;
  }
};
