import type {
  PlanningContentSnapshot,
  RoutineChoice,
} from "@meal-planner/household-api";
import { useQuery } from "@tanstack/react-query";

import { useApiRuntime } from "../api-client/index.js";
import type { DisplayedIdentity } from "../auth/index.js";
import { foodBookQueryOptions } from "./operations.js";

export const usePlanningContentSnapshot = (scope: DisplayedIdentity) =>
  useQuery(foodBookQueryOptions(useApiRuntime(), scope));

export const describeRoutineChoice = (
  choice: RoutineChoice,
  snapshot: PlanningContentSnapshot
): string => {
  switch (choice._tag) {
    case "Options": {
      return choice.optionRefs
        .map(
          (ref) =>
            snapshot.options.find(
              (option) =>
                option.optionId === ref.optionId &&
                option.optionVersion === ref.optionVersion
            )?.label ?? "Saved meal needs review"
        )
        .join(" · ");
    }
    case "External": {
      return (
        snapshot.options.find(
          (option) => option.optionId === choice.optionRef.optionId
        )?.label ?? "Eating out"
      );
    }
    case "Leftover": {
      return "Use prepared food";
    }
    case "Skip": {
      return "Intentionally skip";
    }
    case "Flexible": {
      return "Decide on the day";
    }
    default: {
      return "Meal choice needs review";
    }
  }
};
