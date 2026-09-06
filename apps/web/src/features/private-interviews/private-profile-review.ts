import { ProfileFactValue } from "@meal-planner/household-api";
import type { PersonProfile } from "@meal-planner/household-api";
import type { ProfileCard } from "@meal-planner/private-interview-api";
import { Schema } from "effect";

const sameFactValue = Schema.toEquivalence(ProfileFactValue);

export const matchesCurrentProfileReview = (
  card: ProfileCard,
  profile: PersonProfile
): boolean => {
  const { change } = card;
  if (change._tag === "AddConfirmedProfileFact") {
    return card.reviewedFact === null;
  }
  const current = profile.facts.find((fact) => fact.id === change.factId);
  return (
    current !== undefined &&
    card.reviewedFact !== null &&
    sameFactValue(current.value, card.reviewedFact)
  );
};
