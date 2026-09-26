import {
  initialSetupProgress,
  SetupProgress,
} from "@meal-planner/household-api";
import { Schema } from "effect";

export const initialSetup: SetupProgress = initialSetupProgress;
export const parseSetupProgress = Schema.decodeUnknownSync(SetupProgress);

export const setupDestination = (
  progress: SetupProgress
):
  | "/setup/join"
  | "/setup/people"
  | "/setup/edit-person"
  | "/setup/saved"
  | "/setup/family"
  | "/setup/review"
  | "/setup/ready"
  | "/" => {
  if (progress.status === "paused") {
    return "/setup/saved";
  }
  switch (progress.checkpoint.stage) {
    case "person-manage": {
      return progress.checkpoint.returnTo.stage === "person-draft"
        ? "/setup/people"
        : "/setup/review";
    }
    case "invitation-response":
    case "invitation-link": {
      return "/setup/join";
    }
    case "person-draft":
    case "person-create":
    case "person-invite-draft":
    case "person-invite": {
      return "/setup/people";
    }
    case "person-edit":
    case "person-rename": {
      return "/setup/edit-person";
    }
    case "family-name":
    case "family-create": {
      return "/setup/family";
    }
    case "family-review": {
      return "/setup/review";
    }
    case "ready": {
      return "/setup/ready";
    }
    case "complete": {
      return "/";
    }
    default: {
      throw new Error("Unknown setup checkpoint.");
    }
  }
};
