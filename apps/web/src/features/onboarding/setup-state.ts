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
  | "/setup/saved"
  | "/setup/family"
  | "/setup/review"
  | "/setup/ready"
  | "/" => {
  if (progress.status === "paused") {
    return "/setup/saved";
  }
  switch (progress.checkpoint.stage) {
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
