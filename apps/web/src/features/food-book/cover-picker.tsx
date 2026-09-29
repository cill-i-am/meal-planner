import type { MealOption } from "@meal-planner/household-api";

import {
  Field,
  FieldDescription,
  FieldLabel,
} from "../../components/ui/field.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/toggle-group.js";
import { FoodCover } from "./food-cover.js";

const covers = ["pesto-pasta", "tacos", "fish", "rice-bowls", "pizza"] as const;

export const CoverPicker = ({
  cover,
  onChange,
}: {
  readonly cover: MealOption["cover"];
  readonly onChange: (cover: MealOption["cover"]) => void;
}) => (
  <Field>
    <FieldLabel>Illustrative cover</FieldLabel>
    <FieldDescription>
      Choose artwork for your Food book. It is an illustration, not a photo or
      evidence of this meal’s ingredients.
    </FieldDescription>
    <ToggleGroup
      aria-label="Illustrative cover"
      value={[cover ?? "none"]}
      onValueChange={(values) => {
        const [selected] = values;
        if (selected === "none") {
          onChange(null);
        } else if (covers.some((item) => item === selected)) {
          onChange(selected as MealOption["cover"]);
        }
      }}
      className="flex max-w-full flex-wrap"
    >
      <ToggleGroupItem value="none" className="min-h-20">
        No cover
      </ToggleGroupItem>
      {covers.map((item) => (
        <ToggleGroupItem
          key={item}
          value={item}
          className="flex min-h-20 flex-col"
        >
          <FoodCover cover={item} label={item} className="size-12" />
          <span className="text-xs capitalize">{item.replace("-", " ")}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  </Field>
);
