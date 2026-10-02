import { Schema } from "effect";

import { formatRecipeIngredient } from "./scaling.js";

export const RecipeText = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(4096)
  )
);
const TextList = Schema.Array(RecipeText).pipe(
  Schema.check(Schema.isMaxLength(256))
);
const Amount = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThan(0))
);
const Nonnegative = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
);
export const RecipeDuration = Schema.Struct({
  seconds: Schema.Number.pipe(
    Schema.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
    )
  ),
});
export const RecipeQuantity = Schema.Struct({
  max: Schema.NullOr(Amount),
  unit: Schema.NullOr(RecipeText),
  value: Amount,
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (quantity) => quantity.max === null || quantity.max >= quantity.value,
      { expected: "a quantity range in ascending order" },
      true
    )
  )
);
export const RecipeIngredient = Schema.Struct({
  group: Schema.NullOr(RecipeText),
  ingredientId: Schema.NullOr(RecipeText),
  localName: Schema.NullOr(RecipeText),
  name: RecipeText,
  note: Schema.NullOr(RecipeText),
  optional: Schema.NullOr(Schema.Boolean),
  original: RecipeText,
  preparation: Schema.NullOr(RecipeText),
  quantity: Schema.NullOr(RecipeQuantity),
  size: Schema.NullOr(RecipeText),
});
export type RecipeIngredient = typeof RecipeIngredient.Type;
export const RecipeIngredients = Schema.NonEmptyArray(RecipeIngredient).pipe(
  Schema.check(Schema.isMaxLength(256))
);
export const RecipeTemperature = Schema.Struct({
  unit: Schema.Literals(["C", "F"]),
  value: Schema.Number.pipe(Schema.check(Schema.isFinite())),
});
export const RecipeInstruction = Schema.Struct({
  duration: Schema.NullOr(RecipeDuration),
  equipment: TextList,
  group: Schema.NullOr(RecipeText),
  ingredients: TextList,
  step: Schema.Number.pipe(
    Schema.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(256)
    )
  ),
  techniques: TextList,
  temperature: Schema.NullOr(RecipeTemperature),
  text: RecipeText,
});
export type RecipeInstruction = typeof RecipeInstruction.Type;
export const RecipeInstructions = Schema.NonEmptyArray(RecipeInstruction).pipe(
  Schema.check(
    Schema.isMaxLength(256),
    Schema.makeFilter(
      (steps) => steps.every((step, index) => step.step === index + 1),
      { expected: "consecutive ordered steps starting at one" },
      true
    )
  )
);
const HttpsUrl = RecipeText.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            url.username === "" &&
            url.password === ""
          );
        } catch {
          return false;
        }
      },
      { expected: "an HTTPS URL without credentials" },
      true
    )
  )
);
export const RecipeAuthor = Schema.Struct({
  name: RecipeText,
  url: Schema.NullOr(HttpsUrl),
});
export const RecipeServings = Schema.Struct({
  max: Schema.NullOr(Amount),
  original: RecipeText,
  quantity: Amount,
  unit: Schema.NullOr(RecipeText),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (servings) => servings.max === null || servings.max >= servings.quantity,
      { expected: "a yield range in ascending order" },
      true
    )
  )
);
export const RecipeTimes = Schema.Struct({
  cook: Schema.NullOr(RecipeDuration),
  inactive: Schema.NullOr(RecipeDuration),
  prep: Schema.NullOr(RecipeDuration),
  total: Schema.NullOr(RecipeDuration),
});
export const RecipeNutrient = Schema.Struct({
  unit: Schema.Literals(["g", "mg", "mcg", "kcal", "kJ"]),
  value: Nonnegative,
});
export const RecipeNutrition = Schema.Struct({
  basis: Schema.Struct({
    description: Schema.NullOr(RecipeText),
    servings: Schema.NullOr(Amount),
    type: Schema.Literals(["serving", "recipe", "100g"]),
  }),
  nutrients: Schema.Array(
    Schema.Struct({ amount: RecipeNutrient, name: RecipeText })
  ).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(64),
      Schema.makeFilter(
        (nutrients) =>
          new Set(nutrients.map((n) => n.name)).size === nutrients.length,
        { expected: "unique nutrient names" },
        true
      )
    )
  ),
  original: RecipeText,
  source: Schema.Literal("provided"),
});
export const RecipeDietaryClaim = Schema.Struct({
  kind: Schema.Literals(["diet", "allergen"]),
  name: RecipeText,
  original: RecipeText,
  source: Schema.Literal("provided"),
  value: Schema.Boolean,
});
export const RecipeMedia = Schema.Struct({
  alt: Schema.NullOr(RecipeText),
  caption: Schema.NullOr(RecipeText),
  role: Schema.Literals(["hero", "gallery", "step", "thumbnail"]),
  step: Schema.NullOr(
    Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)))
  ),
  type: Schema.Literals(["image", "video"]),
  url: HttpsUrl,
});
/** Content facts only. Household suitability belongs to planning, never a recipe. */
export const RecipeContentFields = {
  author: Schema.NullOr(RecipeAuthor),
  categories: TextList,
  cuisines: TextList,
  description: Schema.NullOr(RecipeText),
  dietary: Schema.Array(RecipeDietaryClaim).pipe(
    Schema.check(Schema.isMaxLength(64))
  ),
  equipment: TextList,
  ingredients: RecipeIngredients,
  instructions: RecipeInstructions,
  language: Schema.NullOr(
    Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z]{2}$/u)))
  ),
  media: Schema.Array(RecipeMedia).pipe(Schema.check(Schema.isMaxLength(64))),
  name: RecipeText,
  notes: TextList,
  nutrition: Schema.NullOr(RecipeNutrition),
  servings: Schema.NullOr(RecipeServings),
  sourceTags: TextList,
  times: RecipeTimes,
};
export const RecipeDraftContent = Schema.Struct({
  ...RecipeContentFields,
  ingredients: Schema.NullOr(RecipeIngredients),
  instructions: Schema.NullOr(RecipeInstructions),
  name: Schema.NullOr(RecipeText),
});
export type RecipeDraftContent = typeof RecipeDraftContent.Type;

export const recipeContentBlockers = (recipe: RecipeDraftContent) => {
  const unresolvedRequiredFields = (
    ["name", "ingredients", "instructions"] as const
  ).filter((field) => recipe[field] === null);
  const invalidFields: (keyof RecipeDraftContent)[] = [];
  const { total, prep, cook, inactive } = recipe.times;
  if (
    total !== null &&
    [prep, cook, inactive].some(
      (duration) => duration !== null && duration.seconds > total.seconds
    )
  ) {
    invalidFields.push("times");
  }
  const ids = new Set(
    recipe.ingredients?.flatMap((ingredient) =>
      ingredient.ingredientId === null ? [] : [ingredient.ingredientId]
    )
  );
  if (
    recipe.instructions?.some((step) =>
      step.ingredients.some((id) => !ids.has(id))
    )
  ) {
    invalidFields.push("instructions");
  }
  if (
    recipe.media.filter((item) => item.role === "hero").length > 1 ||
    recipe.media.some((item) =>
      item.role === "step"
        ? item.step === null || item.step > (recipe.instructions?.length ?? 0)
        : item.step !== null
    )
  ) {
    invalidFields.push("media");
  }
  if (
    new Set(recipe.dietary.map((claim) => `${claim.kind}:${claim.name}`))
      .size !== recipe.dietary.length
  ) {
    invalidFields.push("dietary");
  }
  return { invalidFields, unresolvedRequiredFields };
};

export const RecipeContent = Schema.Struct(RecipeContentFields).pipe(
  Schema.check(
    Schema.makeFilter(
      (recipe) => recipeContentBlockers(recipe).invalidFields.length === 0,
      {
        expected:
          "consistent durations, valid ingredient and media references, and unique dietary claims",
      },
      true
    )
  )
);
export type RecipeContent = typeof RecipeContent.Type;
export const recipeIngredientFromText = (
  original: string
): RecipeIngredient => ({
  group: null,
  ingredientId: null,
  localName: null,
  name: original,
  note: null,
  optional: null,
  original,
  preparation: null,
  quantity: null,
  size: null,
});
export const recipeInstructionFromText = (
  text: string,
  step: number
): RecipeInstruction => ({
  duration: null,
  equipment: [],
  group: null,
  ingredients: [],
  step,
  techniques: [],
  temperature: null,
  text,
});
export const emptyRecipeDetails = {
  author: null,
  categories: [],
  cuisines: [],
  description: null,
  dietary: [],
  equipment: [],
  language: null,
  media: [],
  notes: [],
  nutrition: null,
  servings: null,
  sourceTags: [],
  times: { cook: null, inactive: null, prep: null, total: null },
} as const;
/** Convenient construction; publication still decodes the complete invariant. */
export const makeRecipeContent = (
  content: Pick<RecipeContent, "name" | "ingredients" | "instructions"> &
    Partial<RecipeContent>
): RecipeContent =>
  Schema.decodeUnknownSync(RecipeContent)({
    ...emptyRecipeDetails,
    ...content,
  });

export const recipeGroups = (
  recipe: Pick<RecipeContent, "ingredients" | "instructions">
): readonly string[] => [
  ...new Set(
    [...recipe.ingredients, ...recipe.instructions].flatMap((item) =>
      item.group === null ? [] : [item.group]
    )
  ),
];
/** Flat display is derived; there is no second editable recipe authority. */
export const recipeDisplayText = (
  recipe: Pick<RecipeContent, "ingredients" | "instructions">
) => ({
  ingredients: recipe.ingredients.map(formatRecipeIngredient),
  instructions: recipe.instructions.map((instruction) => instruction.text),
});
