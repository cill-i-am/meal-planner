import type { HouseholdPerson } from "@meal-planner/household-api";

import { Avatar, AvatarFallback } from "../../components/ui/avatar.js";

const personStatus = (person: HouseholdPerson): string => {
  if (person.isCurrentAdult) {
    return "You";
  }
  if (person.kind === "dependant") {
    return "Child";
  }
  if (person.associationState === "linked") {
    return "Joined";
  }
  if (person.associationState === "invitation_declined") {
    return "Invitation declined";
  }
  if (person.associationState === "invitation_unavailable") {
    return "Invitation unavailable";
  }
  if (person.associationState === "invitation_pending") {
    return "Invitation pending";
  }
  return "Adult";
};

export const PersonRow = ({ person }: { readonly person: HouseholdPerson }) => (
  <div className="flex items-center gap-3 py-2">
    <Avatar size="lg" aria-hidden="true">
      <AvatarFallback tone={person.kind === "adult" ? "lilac" : "peach"}>
        {[...person.displayName][0]}
      </AvatarFallback>
    </Avatar>
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate">{person.displayName}</span>
      <span className="text-muted-foreground text-sm">
        {personStatus(person)}
      </span>
    </div>
  </div>
);
