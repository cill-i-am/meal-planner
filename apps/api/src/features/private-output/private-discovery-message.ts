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

const factDescription = (fact: ProfileFactValue) => {
  switch (fact._tag) {
    case "FoodPreference": {
      const sentiment = {
        dislike: "dislike",
        like: "preference",
        strong_dislike: "strong dislike",
      }[fact.sentiment];
      {
        const checkedResult = `your ${sentiment} for the ${fact.targetKind} “${fact.label}”`;
        return checkedResult;
      }
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
      {
        const checkedResult = `your ${category} “${fact.label}” (${handling})`;
        return checkedResult;
      }
    }
    case "NoKnownHardConstraints": {
      const checkedResult =
        "your statement that you have no known hard food constraints";
      return checkedResult;
    }
    default: {
      const checkedResult: string = fact satisfies never;
      return checkedResult;
    }
  }
};
const proposalDescription = ({
  card,
  proposal,
}: PrivateDiscoveryReviewedProposal) => {
  const { change, reviewedFact } = proposal;
  const prefix =
    card === null
      ? "I've drafted a private proposal to"
      : "I've updated the private proposal to";
  if (change._tag === "AddConfirmedProfileFact") {
    const checkedResult = `${prefix} add ${factDescription(change.fact)}.`;
    return checkedResult;
  }
  if (reviewedFact === null) {
    throw new Error("Reviewed profile proposal requires its current fact");
  }
  const before = factDescription(reviewedFact);
  switch (change._tag) {
    case "ConfirmProfileFact": {
      const checkedResult = `${prefix} confirm ${before}.`;
      return checkedResult;
    }
    case "ReplaceOrdinaryProfileFact": {
      const checkedResult = `${prefix} replace ${before} with ${factDescription(change.fact)}.`;
      return checkedResult;
    }
    case "RemoveOrdinaryProfileFact": {
      const checkedResult = `${prefix} remove ${before}.`;
      return checkedResult;
    }
    case "ConfirmHardConstraintReduction": {
      const checkedResult: string =
        change.replacement === null
          ? `${prefix} remove ${before}; separate safety confirmation is required.`
          : `${prefix} replace ${before} with ${factDescription(change.replacement)}; separate safety confirmation is required.`;
      return checkedResult;
    }
    default: {
      const checkedResult: string = change satisfies never;
      return checkedResult;
    }
  }
};
const fieldDescription = (label: string, field: MealFallbackNeed["reason"]) => {
  switch (field._tag) {
    case "Answered": {
      const checkedResult: string[] = [`${label}: ${field.value}`];
      return checkedResult;
    }
    case "NoInformation": {
      const checkedResult: string[] = [`${label}: no information supplied`];
      return checkedResult;
    }
    case "Declined": {
      const checkedResult: string[] = [`${label}: discussion declined`];
      return checkedResult;
    }
    case "Unanswered": {
      const checkedResult: string[] = [];
      return checkedResult;
    }
    default: {
      const checkedResult: string[] = field satisfies never;
      return checkedResult;
    }
  }
};
const optionDescription = (field: MealFallbackNeed["acceptableOption"]) => {
  if (field._tag !== "Answered") {
    const checkedResult: string[] = fieldDescription(
      "acceptable option",
      field
    );
    return checkedResult;
  }
  const { value } = field;
  {
    const checkedResult: string[] = [
      `${value.kind} option: ${value.description}`,
      ...(value.quantity === null ? [] : [`quantity: ${value.quantity}`]),
      ...(value.substitutions === null
        ? []
        : [`substitution scope: ${value.substitutions}`]),
    ];
    return checkedResult;
  }
};
const needDescription = (need: MealFallbackNeed) => {
  const prefix = `I've noted this alternative meal need privately for ${need.subject}`;
  if (need.disposition._tag === "Declined") {
    const checkedResult = `${prefix}: discussion of this alternative-meal need was declined.`;
    return checkedResult;
  }
  if (need.disposition._tag === "Withdrawn") {
    const checkedResult = `${prefix}: this alternative-meal need was withdrawn.`;
    return checkedResult;
  }
  const details = [
    ...fieldDescription("reason", need.reason),
    ...optionDescription(need.acceptableOption),
    ...fieldDescription("manageable extra preparation", need.extraPreparation),
  ];
  {
    const checkedResult: string =
      details.length === 0
        ? `${prefix}: an alternative meal is needed.`
        : `${prefix}: ${details.join("; ")}`;
    return checkedResult;
  }
};

/** Wording follows validated private state and reviewed draft effects, not model claims. */
export const renderPrivateDiscoveryMessage = (
  before: PrivateDiscoveryContinuity,
  after: PrivateDiscoveryContinuity,
  decision: PrivateDiscoveryReplyDecision,
  proposals: readonly PrivateDiscoveryReviewedProposal[]
) => {
  if (decision._tag === "Stop") {
    const checkedResult = "We can stop here.";
    return checkedResult;
  }
  const previous = new Map(
    before.mealFallbackNeeds.map((need) => [need.id, need])
  );
  const sections = proposals.map(proposalDescription);
  if (proposals.length > 0) {
    sections.push(
      "Review each proposal and correct anything I missed. It reaches your household profile only if you confirm it."
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
      : "If that's enough for now, you can finish this conversation."
  );
  {
    const checkedResult: string = sections.join("\n\n");
    return checkedResult;
  }
};
