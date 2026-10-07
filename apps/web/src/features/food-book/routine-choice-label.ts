import type {
  PlanningContentSnapshot,
  RoutineChoice,
} from "@meal-planner/household-api";

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
