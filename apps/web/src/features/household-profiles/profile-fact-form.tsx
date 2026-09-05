import { ProfileFactValue } from "@meal-planner/household-api";
import type { ProfileCommand, ProfileFact } from "@meal-planner/household-api";
import { useForm } from "@tanstack/react-form";
import { Option, Schema } from "effect";

import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";

export const describeProfileFact = (fact: ProfileFactValue): string => {
  switch (fact._tag) {
    case "FoodPreference": {
      return `${fact.label}: ${fact.sentiment.replaceAll("_", " ")} (${fact.targetKind})`;
    }
    case "HardConstraint": {
      return `${fact.label}: ${fact.handling.replaceAll("_", " ")} (${fact.category.replaceAll("_", " ")})`;
    }
    case "NoKnownHardConstraints": {
      return "No known hard constraints — explicitly confirmed";
    }
    default: {
      throw new Error(`Unreachable profile fact: ${fact satisfies never}`);
    }
  }
};

interface Fields {
  category: string;
  confirmation: boolean;
  handling: string;
  kind: string;
  label: string;
  removal: boolean;
  sentiment: string;
  targetKind: string;
}
const initialFields = (fact?: ProfileFact): Fields => ({
  category:
    fact?.value._tag === "HardConstraint" ? fact.value.category : "allergen",
  confirmation: false,
  handling:
    fact?.value._tag === "HardConstraint" ? fact.value.handling : "exclude",
  kind: fact?.value._tag ?? "FoodPreference",
  label:
    fact?.value._tag === "NoKnownHardConstraints"
      ? ""
      : (fact?.value.label ?? ""),
  removal: false,
  sentiment:
    fact?.value._tag === "FoodPreference" ? fact.value.sentiment : "like",
  targetKind:
    fact?.value._tag === "FoodPreference"
      ? fact.value.targetKind
      : "ingredient",
});
const decodeFact = (fields: Fields) => {
  if (fields.kind === "FoodPreference") {
    return Schema.decodeUnknownOption(ProfileFactValue)({
      _tag: fields.kind,
      label: fields.label.trim(),
      sentiment: fields.sentiment,
      targetKind: fields.targetKind,
    });
  }
  if (fields.kind === "HardConstraint") {
    return Schema.decodeUnknownOption(ProfileFactValue)({
      _tag: fields.kind,
      category: fields.category,
      handling: fields.handling,
      label: fields.label.trim(),
    });
  }
  return Schema.decodeUnknownOption(ProfileFactValue)({ _tag: fields.kind });
};

const formLabels = (fact: ProfileFact | undefined, safety: boolean) => {
  if (fact === undefined) {
    return { legend: "Add a food fact", submit: "Add fact" };
  }
  if (safety) {
    return {
      legend: "Confirm a safety change",
      submit: "Confirm safety change",
    };
  }
  return { legend: "Correct this preference", submit: "Save correction" };
};
const proposedMeaning = (values: Fields) => {
  if (values.removal) {
    return "Remove this fact. No replacement is recorded.";
  }
  const proposed = decodeFact(values);
  return Option.isSome(proposed)
    ? describeProfileFact(proposed.value)
    : "Complete the fields above.";
};

const commandFor = (
  value: ProfileFactValue,
  fact: ProfileFact | undefined,
  basis: "self" | "household_adult" | "provisional",
  removal: boolean
): ProfileCommand => {
  if (fact !== undefined) {
    if (fact.value._tag !== "FoodPreference") {
      return {
        _tag: "ConfirmHardConstraintReduction",
        confirmation: "I confirm this safety constraint change",
        factId: fact.id,
        replacement: removal ? null : value,
      };
    }
    if (value._tag !== "FoodPreference") {
      throw new Error("Ordinary edits require a food preference");
    }
    return { _tag: "ReplaceOrdinaryProfileFact", fact: value, factId: fact.id };
  }
  return basis === "provisional"
    ? { _tag: "AddProvisionalProfileFact", fact: value }
    : { _tag: "AddConfirmedProfileFact", basis, fact: value };
};

/** Existing notebook form controls; safety changes are deliberately separate from ordinary editing. */
export const ProfileFactForm = ({
  basis,
  disabled,
  fact,
  submit,
}: {
  readonly basis: "self" | "household_adult" | "provisional";
  readonly disabled: boolean;
  readonly fact?: ProfileFact;
  readonly submit: (command: ProfileCommand) => void;
}) => {
  const safety = fact !== undefined && fact.value._tag !== "FoodPreference";
  const prefix = fact?.id ?? "new-profile-fact";
  const labels = formLabels(fact, safety);
  const form = useForm({
    defaultValues: initialFields(fact),
    onSubmit: ({ value }) => {
      if (
        disabled ||
        ((safety || value.kind === "NoKnownHardConstraints") &&
          !value.confirmation)
      ) {
        return;
      }
      const decoded = decodeFact(value);
      if (Option.isSome(decoded)) {
        submit(commandFor(decoded.value, fact, basis, value.removal));
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
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="font-semibold">{labels.legend}</legend>
        {fact === undefined && (
          <p>
            {basis === "provisional"
              ? "Information for another adult is provisional until they confirm or correct it."
              : "This information will be confirmed by you."}
          </p>
        )}
        {safety && (
          <p>Current safety meaning: {describeProfileFact(fact.value)}</p>
        )}
        {(fact === undefined || safety) && (
          <form.Field name="kind">
            {(field) => (
              <div>
                <Label htmlFor={`${prefix}-kind`}>Fact type</Label>
                <select
                  className="input"
                  id={`${prefix}-kind`}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="FoodPreference">Food preference</option>
                  <option value="HardConstraint">
                    Hard dietary or safety constraint
                  </option>
                  {basis !== "provisional" && (
                    <option value="NoKnownHardConstraints">
                      No known hard constraints
                    </option>
                  )}
                </select>
              </div>
            )}
          </form.Field>
        )}
        <form.Subscribe selector={(state) => state.values.kind}>
          {(kind) => (
            <>
              {kind !== "NoKnownHardConstraints" && (
                <form.Field name="label">
                  {(field) => (
                    <div>
                      <Label htmlFor={`${prefix}-label`}>
                        Food or ingredient
                      </Label>
                      <Input
                        id={`${prefix}-label`}
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
              {kind === "FoodPreference" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <form.Field name="sentiment">
                    {(field) => (
                      <div>
                        <Label htmlFor={`${prefix}-sentiment`}>
                          Preference
                        </Label>
                        <select
                          className="input"
                          id={`${prefix}-sentiment`}
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                        >
                          <option value="like">Like</option>
                          <option value="dislike">Dislike</option>
                          <option value="strong_dislike">Strong dislike</option>
                        </select>
                      </div>
                    )}
                  </form.Field>
                  <form.Field name="targetKind">
                    {(field) => (
                      <div>
                        <Label htmlFor={`${prefix}-target`}>Applies to</Label>
                        <select
                          className="input"
                          id={`${prefix}-target`}
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                        >
                          <option value="ingredient">Ingredient</option>
                          <option value="dish">Dish</option>
                          <option value="cuisine">Cuisine</option>
                        </select>
                      </div>
                    )}
                  </form.Field>
                </div>
              )}
              {kind === "HardConstraint" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <form.Field name="category">
                    {(field) => (
                      <div>
                        <Label htmlFor={`${prefix}-category`}>
                          Constraint category
                        </Label>
                        <select
                          className="input"
                          id={`${prefix}-category`}
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                        >
                          <option value="allergen">Allergen</option>
                          <option value="dietary_rule">Dietary rule</option>
                          <option value="ingredient_avoidance">
                            Ingredient avoidance
                          </option>
                          <option value="other_safety">
                            Other safety constraint
                          </option>
                        </select>
                      </div>
                    )}
                  </form.Field>
                  <form.Field name="handling">
                    {(field) => (
                      <div>
                        <Label htmlFor={`${prefix}-handling`}>
                          Required handling
                        </Label>
                        <select
                          className="input"
                          id={`${prefix}-handling`}
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                        >
                          <option value="exclude">Exclude</option>
                          <option value="requires_adaptation">
                            Requires adaptation
                          </option>
                        </select>
                      </div>
                    )}
                  </form.Field>
                </div>
              )}
              {safety && (
                <form.Field name="removal">
                  {(field) => (
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.checked)
                        }
                      />
                      Remove this safety fact instead of replacing it
                    </label>
                  )}
                </form.Field>
              )}
              {(safety || kind === "NoKnownHardConstraints") && (
                <>
                  <form.Subscribe selector={(state) => state.values}>
                    {(values) => (
                      <p>Proposed safety meaning: {proposedMeaning(values)}</p>
                    )}
                  </form.Subscribe>
                  <form.Field name="confirmation">
                    {(field) => (
                      <label className="flex min-h-11 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.checked)
                          }
                        />
                        I confirm this safety constraint change
                      </label>
                    )}
                  </form.Field>
                </>
              )}
            </>
          )}
        </form.Subscribe>
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <Button
              type="submit"
              disabled={
                disabled ||
                Option.isNone(decodeFact(values)) ||
                ((safety || values.kind === "NoKnownHardConstraints") &&
                  !values.confirmation)
              }
            >
              {labels.submit}
            </Button>
          )}
        </form.Subscribe>
      </fieldset>
    </form>
  );
};
