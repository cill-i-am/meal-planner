import type { ProfileFactValue } from "@meal-planner/household-api";
import type { ProfileCard } from "@meal-planner/private-interview-api";

import type {
  PrivateDiscoveryContinuity,
  PrivateDiscoveryReplyDecision,
} from "./private-discovery-continuity.js";
import type { MealFallbackNeed } from "./private-discovery-needs.js";

/** Produced only by native proposal review, never decoded from model output. */
export interface PrivateDiscoveryReviewedProposal {
  readonly card: ProfileCard | null;
  readonly proposal: Pick<
    ProfileCard,
    "change" | "expectedProfileVersion" | "reviewedFact"
  >;
}

const factDescription = (fact: ProfileFactValue): string => {
  switch (fact._tag) {
    case "FoodPreference": {
      const sentiment = {
        dislike: "dislike",
        like: "preference",
        strong_dislike: "strong dislike",
      }[fact.sentiment];
      return `your ${sentiment} for the ${fact.targetKind} “${fact.label}”`;
    }
    case "HardConstraint": {
      const category = {
        allergen: "allergen",
        dietary_rule: "dietary rule",
        ingredient_avoidance: "ingredient avoidance",
        other_safety: "other food safety constraint",
      }[fact.category];
      const handling =
        fact.handling === "exclude" ? "exclude" : "requires adaptation";
      return `your ${category} “${fact.label}” (${handling})`;
    }
    case "NoKnownHardConstraints": {
      return "your statement that you have no known hard food constraints";
    }
    default: {
      return fact satisfies never;
    }
  }
};
const proposalDescription = ({
  card,
  proposal,
}: PrivateDiscoveryReviewedProposal): string => {
  const { change, reviewedFact } = proposal;
  const prefix =
    card === null ? "New profile proposal" : "Revised profile proposal";
  if (change._tag === "AddConfirmedProfileFact") {
    return `${prefix}: add ${factDescription(change.fact)}.`;
  }
  if (reviewedFact === null) {
    throw new Error("Reviewed profile proposal requires its current fact");
  }
  const before = factDescription(reviewedFact);
  switch (change._tag) {
    case "ConfirmProfileFact": {
      return `${prefix}: confirm ${before}.`;
    }
    case "ReplaceOrdinaryProfileFact": {
      return `${prefix}: replace ${before} with ${factDescription(change.fact)}.`;
    }
    case "RemoveOrdinaryProfileFact": {
      return `${prefix}: remove ${before}.`;
    }
    case "ConfirmHardConstraintReduction": {
      return change.replacement === null
        ? `${prefix}: remove ${before}; separate safety confirmation is required.`
        : `${prefix}: replace ${before} with ${factDescription(change.replacement)}; separate safety confirmation is required.`;
    }
    default: {
      return change satisfies never;
    }
  }
};
const fieldDescription = (
  label: string,
  field: MealFallbackNeed["reason"]
): string[] => {
  switch (field._tag) {
    case "Answered": {
      return [`${label}: ${field.value}`];
    }
    case "NoInformation": {
      return [`${label}: no information supplied`];
    }
    case "Declined": {
      return [`${label}: discussion declined`];
    }
    case "Unanswered": {
      return [];
    }
    default: {
      return field satisfies never;
    }
  }
};
const optionDescription = (
  field: MealFallbackNeed["acceptableOption"]
): string[] => {
  if (field._tag !== "Answered") {
    return fieldDescription("acceptable option", field);
  }
  const { value } = field;
  return [
    `${value.kind} option: ${value.description}`,
    ...(value.quantity === null ? [] : [`quantity: ${value.quantity}`]),
    ...(value.substitutions === null
      ? []
      : [`substitution scope: ${value.substitutions}`]),
  ];
};
const needDescription = (need: MealFallbackNeed): string => {
  const prefix = `Private conversation context for ${need.subject}`;
  if (need.disposition._tag === "Declined") {
    return `${prefix}: discussion of this alternative-meal need was declined.`;
  }
  if (need.disposition._tag === "Withdrawn") {
    return `${prefix}: this alternative-meal need was withdrawn.`;
  }
  const details = [
    ...fieldDescription("reason", need.reason),
    ...optionDescription(need.acceptableOption),
    ...fieldDescription("manageable extra preparation", need.extraPreparation),
  ];
  return details.length === 0
    ? `${prefix}: an alternative meal is needed.`
    : `${prefix}: ${details.join("; ")}`;
};

/** Wording follows validated private state and reviewed draft effects, not model claims. */
export const renderPrivateDiscoveryMessage = (
  before: PrivateDiscoveryContinuity,
  after: PrivateDiscoveryContinuity,
  decision: PrivateDiscoveryReplyDecision,
  proposals: readonly PrivateDiscoveryReviewedProposal[]
): string => {
  if (decision._tag === "Stop") {
    return "We can stop here.";
  }
  const previous = new Map(
    before.mealFallbackNeeds.map((need) => [need.id, need])
  );
  const sections = proposals.map(proposalDescription);
  if (proposals.length > 0) {
    sections.push(
      "Review the profile proposals in the interface. They remain unconfirmed."
    );
  }
  for (const need of after.mealFallbackNeeds) {
    if (JSON.stringify(previous.get(need.id)) !== JSON.stringify(need)) {
      sections.push(needDescription(need));
    }
  }
  sections.push(
    decision._tag === "Ask"
      ? decision.question
      : "You can finish this conversation when you're ready."
  );
  return sections.join("\n\n");
};
