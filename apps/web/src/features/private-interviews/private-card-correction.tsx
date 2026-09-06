import { ProfileFactValue } from "@meal-planner/household-api";
import type { ProfileFact } from "@meal-planner/household-api";
import { ProfileCardChange } from "@meal-planner/private-interview-api";
import type { ProfileCard } from "@meal-planner/private-interview-api";
import { useForm } from "@tanstack/react-form";
import { Option, Schema } from "effect";

import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";

const proposedFact = (card: ProfileCard, current: ProfileFact | undefined) => {
  switch (card.change._tag) {
    case "AddConfirmedProfileFact":
    case "ReplaceOrdinaryProfileFact": {
      return card.change.fact;
    }
    case "ConfirmHardConstraintReduction": {
      return card.change.replacement ?? current?.value;
    }
    default: {
      return current?.value;
    }
  }
};
const initialFields = (card: ProfileCard, current: ProfileFact | undefined) => {
  const fact = proposedFact(card, current);
  let action = "replace";
  if (card.change._tag === "ConfirmProfileFact") {
    action = "confirm";
  }
  if (
    card.change._tag === "RemoveOrdinaryProfileFact" ||
    (card.change._tag === "ConfirmHardConstraintReduction" &&
      card.change.replacement === null)
  ) {
    action = "remove";
  }
  return {
    action,
    category: fact?._tag === "HardConstraint" ? fact.category : "allergen",
    handling: fact?._tag === "HardConstraint" ? fact.handling : "exclude",
    kind: fact?._tag ?? "FoodPreference",
    label: fact?._tag === "NoKnownHardConstraints" ? "" : (fact?.label ?? ""),
    sentiment: fact?._tag === "FoodPreference" ? fact.sentiment : "like",
    targetKind:
      fact?._tag === "FoodPreference" ? fact.targetKind : "ingredient",
  };
};
type Fields = ReturnType<typeof initialFields>;
const decodeChange = (
  fields: Fields,
  card: ProfileCard,
  current: ProfileFact | undefined
) => {
  if (card.change._tag !== "AddConfirmedProfileFact") {
    if (current === undefined) {
      return Option.none();
    }
    if (fields.action === "confirm") {
      return Schema.decodeUnknownOption(ProfileCardChange)({
        _tag: "ConfirmProfileFact",
        factId: current.id,
      });
    }
    if (fields.action === "remove") {
      return Schema.decodeUnknownOption(ProfileCardChange)(
        current.value._tag === "FoodPreference"
          ? { _tag: "RemoveOrdinaryProfileFact", factId: current.id }
          : {
              _tag: "ConfirmHardConstraintReduction",
              factId: current.id,
              replacement: null,
            }
      );
    }
  }
  let value: object = { _tag: fields.kind };
  if (fields.kind === "FoodPreference") {
    value = {
      _tag: fields.kind,
      label: fields.label.trim(),
      sentiment: fields.sentiment,
      targetKind: fields.targetKind,
    };
  }
  if (fields.kind === "HardConstraint") {
    value = {
      _tag: fields.kind,
      category: fields.category,
      handling: fields.handling,
      label: fields.label.trim(),
    };
  }
  const fact = Schema.decodeUnknownOption(ProfileFactValue)(value);
  if (Option.isNone(fact)) {
    return Option.none();
  }
  if (card.change._tag === "AddConfirmedProfileFact") {
    return Option.some({
      _tag: "AddConfirmedProfileFact" as const,
      fact: fact.value,
    });
  }
  if (current?.value._tag === "FoodPreference") {
    return Schema.decodeUnknownOption(ProfileCardChange)({
      _tag: "ReplaceOrdinaryProfileFact",
      fact: fact.value,
      factId: current.id,
    });
  }
  return Schema.decodeUnknownOption(ProfileCardChange)({
    _tag: "ConfirmHardConstraintReduction",
    factId: current?.id,
    replacement: fact.value,
  });
};

const selects = {
  category: {
    label: "Constraint category",
    options: [
      ["allergen", "Allergen"],
      ["dietary_rule", "Dietary rule"],
      ["ingredient_avoidance", "Ingredient avoidance"],
      ["other_safety", "Other safety constraint"],
    ],
  },
  handling: {
    label: "Required handling",
    options: [
      ["exclude", "Exclude"],
      ["requires_adaptation", "Requires adaptation"],
    ],
  },
  kind: {
    label: "Fact type",
    options: [
      ["FoodPreference", "Food preference"],
      ["HardConstraint", "Hard dietary or safety constraint"],
      ["NoKnownHardConstraints", "No known hard constraints"],
    ],
  },
  sentiment: {
    label: "Preference",
    options: [
      ["like", "Like"],
      ["dislike", "Dislike"],
      ["strong_dislike", "Strong dislike"],
    ],
  },
  targetKind: {
    label: "Applies to",
    options: [
      ["ingredient", "Ingredient"],
      ["dish", "Dish"],
      ["cuisine", "Cuisine"],
    ],
  },
} as const;

export const PrivateCardCorrection = ({
  card,
  current,
  disabled,
  revise,
}: {
  readonly card: ProfileCard;
  readonly current: ProfileFact | undefined;
  readonly disabled: boolean;
  readonly revise: (change: ProfileCardChange) => void;
}) => {
  const form = useForm({
    defaultValues: initialFields(card, current),
    onSubmit: ({ value }) => {
      const change = decodeChange(value, card, current);
      if (!disabled && Option.isSome(change)) {
        revise(change.value);
      }
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <fieldset disabled={disabled} className="field-stack">
        <legend>Review or correct this proposal</legend>
        <p className="helper">
          Saving a revision keeps it private. You will confirm it separately
          before it changes your household profile.
        </p>
        {current !== undefined && (
          <form.Field name="action">
            {(field) => (
              <div>
                <Label htmlFor={`${card.id}-action`}>Proposed change</Label>
                <select
                  className="input"
                  id={`${card.id}-action`}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="confirm">Confirm the current fact</option>
                  <option value="replace">Correct the fact</option>
                  <option value="remove">Remove the fact</option>
                </select>
              </div>
            )}
          </form.Field>
        )}
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <>
              {(current === undefined || values.action === "replace") && (
                <>
                  {(Object.keys(selects) as (keyof typeof selects)[])
                    .filter((key) => {
                      if (key === "kind") {
                        return (
                          current === undefined ||
                          current.value._tag !== "FoodPreference"
                        );
                      }
                      if (values.kind === "FoodPreference") {
                        return key === "sentiment" || key === "targetKind";
                      }
                      return (
                        values.kind === "HardConstraint" &&
                        (key === "category" || key === "handling")
                      );
                    })
                    .map((key) => (
                      <form.Field key={key} name={key}>
                        {(field) => (
                          <div>
                            <Label htmlFor={`${card.id}-${key}`}>
                              {selects[key].label}
                            </Label>
                            <select
                              className="input"
                              id={`${card.id}-${key}`}
                              value={field.state.value}
                              onChange={(event) =>
                                field.handleChange(
                                  event.target.value as typeof field.state.value
                                )
                              }
                            >
                              {selects[key].options.map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </form.Field>
                    ))}
                  {values.kind !== "NoKnownHardConstraints" && (
                    <form.Field name="label">
                      {(field) => (
                        <div>
                          <Label htmlFor={`${card.id}-label`}>
                            Food or ingredient
                          </Label>
                          <Input
                            id={`${card.id}-label`}
                            maxLength={120}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                          />
                        </div>
                      )}
                    </form.Field>
                  )}
                </>
              )}
              <Button
                type="submit"
                disabled={
                  disabled || Option.isNone(decodeChange(values, card, current))
                }
              >
                Save revised proposal
              </Button>
            </>
          )}
        </form.Subscribe>
      </fieldset>
    </form>
  );
};
