import type { RecipeContent, RecipeIngredient } from "./content.js";

export const formatRecipeIngredient = (
  ingredient: RecipeIngredient
): string => {
  const { quantity } = ingredient;
  const amount =
    quantity === null
      ? ""
      : `${quantity.value}${quantity.max === null ? "" : `–${quantity.max}`}${quantity.unit === null ? "" : ` ${quantity.unit}`} `;
  const name = ingredient.localName ?? ingredient.name;
  return `${amount}${ingredient.size === null ? "" : `${ingredient.size} `}${name}${ingredient.preparation === null ? "" : `, ${ingredient.preparation}`}${ingredient.note === null ? "" : ` (${ingredient.note})`}${ingredient.optional === true ? " (optional)" : ""}`;
};

export type RecipeScalingResult =
  | {
      readonly _tag: "CannotScale";
      readonly reason:
        | "unknown_servings"
        | "ambiguous_servings"
        | "non_serving_yield"
        | "invalid_target"
        | "amount_overflow";
    }
  | {
      readonly _tag: "Scaled";
      readonly servings: number;
      readonly ingredients: readonly RecipeIngredient[];
      readonly unresolvedIngredientIndexes: readonly number[];
    };

/** A preview derived from confirmed facts. Never changes the source recipe or implies shopping approval. */
export const scaleRecipeIngredients = (
  recipe: RecipeContent,
  targetServings: number
): RecipeScalingResult => {
  if (!Number.isFinite(targetServings) || targetServings <= 0) {
    return { _tag: "CannotScale", reason: "invalid_target" };
  }
  const source = recipe.servings;
  if (source === null) {
    return { _tag: "CannotScale", reason: "unknown_servings" };
  }
  if (source.max !== null && source.max !== source.quantity) {
    return { _tag: "CannotScale", reason: "ambiguous_servings" };
  }
  if (
    source.unit !== null &&
    source.unit !== "serving" &&
    source.unit !== "servings"
  ) {
    return { _tag: "CannotScale", reason: "non_serving_yield" };
  }
  const factor = targetServings / source.quantity;
  const unresolvedIngredientIndexes: number[] = [];
  const measuredUnits = new Set([
    "g",
    "kg",
    "ml",
    "l",
    "tsp",
    "tbsp",
    "cup",
    "oz",
    "lb",
    "fl oz",
  ]);
  const ingredients = recipe.ingredients.map((ingredient, index) => {
    const { quantity } = ingredient;
    if (quantity === null) {
      unresolvedIngredientIndexes.push(index);
      return ingredient;
    }
    const value = quantity.value * factor;
    const max = quantity.max === null ? null : quantity.max * factor;
    const count =
      quantity.unit === null ||
      ["item", "piece", "pieces"].includes(quantity.unit);
    const wholeCount =
      count &&
      Number.isInteger(value) &&
      (max === null || Number.isInteger(max));
    const measured = quantity.unit !== null && measuredUnits.has(quantity.unit);
    if (factor !== 1 && !wholeCount && !measured) {
      unresolvedIngredientIndexes.push(index);
      return { ...ingredient, quantity: null };
    }
    return { ...ingredient, quantity: { ...quantity, max, value } };
  });
  if (
    ingredients.some(
      (ingredient) =>
        ingredient.quantity !== null &&
        (!Number.isFinite(ingredient.quantity.value) ||
          ingredient.quantity.value <= 0 ||
          (ingredient.quantity.max !== null &&
            !Number.isFinite(ingredient.quantity.max)))
    )
  ) {
    return { _tag: "CannotScale", reason: "amount_overflow" };
  }
  return {
    _tag: "Scaled",
    ingredients,
    servings: targetServings,
    unresolvedIngredientIndexes,
  };
};
