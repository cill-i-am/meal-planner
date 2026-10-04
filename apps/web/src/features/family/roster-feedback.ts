import {
  HouseholdPeopleOperationError,
  householdPeopleFailureCode,
} from "../household-people/index.js";

export const terminalFailure = (error: Error) =>
  [
    "association_conflict",
    "association_stale",
    "departure_conflict",
    "invitation_rejected",
    "lifecycle_conflict",
    "mutation_collision",
    "organizer_required",
    "person_not_found",
    "stale_version",
    "invalid_request",
    "unauthorized",
  ].includes(householdPeopleFailureCode(error) ?? "");

export const failureMessage = (error: Error) => {
  if (error instanceof HouseholdPeopleOperationError) {
    if (error.invitationRejection === "already_invited") {
      return "An invitation is already waiting for this email. Check the address or review your family.";
    }
    if (error.invitationRejection === "already_member") {
      return "This email already belongs to someone in your family. Check the address and try again.";
    }
    if (error.invitationRejection === "invalid_email") {
      return "Check the email address and try again.";
    }
    if (error.invitationRejection === "limit") {
      return "Your family has too many pending invitations. Review your family before inviting again.";
    }
    if (
      error.code === "organizer_required" ||
      error.invitationRejection === "forbidden"
    ) {
      return "Only the family organiser can make this change.";
    }
    if (error.code === "stale_version" || error.code === "association_stale") {
      return "This person changed. Close this window and review the latest family list.";
    }
    if (
      error.code === "association_conflict" ||
      error.code === "departure_conflict"
    ) {
      return "This person’s account state changed. Close this window and review the latest family list.";
    }
  }
  if (terminalFailure(error)) {
    return "This change couldn’t be made. Close this window and review the latest family list.";
  }
  return "We couldn’t confirm the change. Try again to check the same request.";
};
