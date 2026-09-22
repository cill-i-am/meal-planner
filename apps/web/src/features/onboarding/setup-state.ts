import { SetupProgress } from "@meal-planner/household-api";
import { Schema } from "effect";

export const initialSetup: SetupProgress = {
  checkpoint: { name: "", stage: "family-name" },
  status: "active",
};
export const parseSetupProgress = Schema.decodeUnknownSync(SetupProgress);

export const setupDestination = (
  progress: SetupProgress
):
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
